// /api/documents — factures, paiements, reçus, présences, attestations.
//   GET ?invoices=1[&order=]              factures (client : les siennes ; équipe « commandes » : toutes)
//   GET ?invoice=<id>[&pdf=1]             une facture, état du paiement calculé à partir des paiements
//   GET ?payments=<commande>              paiements d'une commande
//   GET ?receipt=<paiement>               reçu en PDF (encaissement réel uniquement)
//   GET ?roster=<session>[&pdf=1]         participants et présences (équipe « formations »)
//   GET ?learner=<inscription>            présences, documents de session et attestation d'un apprenant
//   GET ?eligibility=<inscription>        conditions de délivrance, vérifiées une à une (équipe)
//   GET ?certificate=<id>&pdf=1           attestation ou certificat en PDF
//   GET ?verify=<code>                    vérification publique d'une attestation (sans connexion)
//   POST {action: 'payment' | 'invoice' | 'invoice_cancel' | 'attendance' | 'result' | 'certificate' | 'certificate_revoke', …}
import { z } from 'zod';
import { handler, send, readJson, HttpError } from './_lib/http.js';
import { requireUser, rateLimit } from './_lib/auth.js';
import { actorOf, isTeam } from './_lib/activity.js';
import * as s from './_lib/schemas.js';
import * as billing from './_lib/services/billing.js';
import * as learning from './_lib/services/learning.js';
import { invoicePdf, receiptPdf, attendanceSheetPdf, certificatePdf, sendPdf } from './_lib/pdf.js';
import { siteUrl } from './_lib/emails.js';

const id = (label) => s.uuid(label);
const origin = (req) => siteUrl() || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;

export default handler({
  async GET(req, res) {
    const q = req.query || {};
    if (q.verify !== undefined) {
      // Public : vérifier qu'une attestation présentée est authentique.
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
      await rateLimit(`verify:${ip}`, 30, 10, 'Trop de vérifications. Réessayez dans quelques minutes.');
      const code = s.parse(z.string().trim().regex(/^[0-9A-Fa-f]{16}$/, 'Code de vérification invalide (16 caractères).'), q.verify);
      return send(res, 200, await learning.verifyCertificate(code));
    }
    const actor = actorOf(await requireUser(req));
    if (q.invoices === '1') return send(res, 200, { invoices: await billing.listInvoices(actor, { orderId: q.order ? s.parse(id('Commande'), q.order) : null }) });
    if (q.invoice) {
      const inv = await billing.getInvoice(actor, s.parse(id('Facture'), q.invoice));
      if (q.pdf === '1') return sendPdf(res, await invoicePdf(inv));
      return send(res, 200, { invoice: inv });
    }
    if (q.payments) return send(res, 200, await billing.listPayments(actor, s.parse(id('Commande'), q.payments)));
    if (q.receipt) return sendPdf(res, await receiptPdf(await billing.receiptData(actor, s.parse(id('Paiement'), q.receipt))));
    if (q.roster) {
      const sid = s.parse(id('Session'), q.roster);
      if (q.pdf === '1') return sendPdf(res, await attendanceSheetPdf(await learning.attendanceSheet(actor, sid)));
      return send(res, 200, await learning.sessionRoster(actor, sid));
    }
    if (q.learner) return send(res, 200, await learning.learnerView(actor, s.parse(id('Inscription'), q.learner)));
    if (q.eligibility) {
      if (!isTeam(actor, 'trainings')) throw new HttpError(403, 'Accès réservé à l’équipe « formations ».');
      const el = await learning.eligibility(s.parse(id('Inscription'), q.eligibility));
      return send(res, 200, { checks: el.checks, eligible: el.eligible, existing: el.existing, rules: el.rules, attendance_rate: el.attendance_rate });
    }
    if (q.certificate) {
      const c = await learning.getCertificate(actor, s.parse(id('Attestation'), q.certificate));
      if (c.revoked_at) throw new HttpError(410, 'Ce document a été révoqué.');
      if (q.pdf === '1') return sendPdf(res, await certificatePdf(c, { verifyUrl: `${origin(req)}/verifier?code=${c.verify_code}` }));
      return send(res, 200, { certificate: c });
    }
    throw new HttpError(400, 'Requête inconnue.');
  },

  async POST(req, res) {
    const actor = actorOf(await requireUser(req));
    const b = await readJson(req);
    switch (b.action) {
      case 'payment': {
        const p = s.parse(z.object({
          order_id: id('Commande'),
          amount_fcfa: z.number({ invalid_type_error: 'Montant invalide.' }).int('Montant : nombre entier de FCFA.').refine((n) => n !== 0 && Math.abs(n) <= 1e10, 'Montant invalide.'),
          method: s.oneOf([...billing.PAYMENT_METHODS, 'correction'], 'Moyen de paiement'),
          reference: s.text('Référence', { max: 120 }),
          received_on: s.date('Date du paiement'),
          note: s.text('Note', { max: 500 }),
        }), b);
        return send(res, 201, await billing.recordPayment(actor, p.order_id, p));
      }
      case 'invoice': {
        const p = s.parse(z.object({ order_id: id('Commande'), due_date: s.date('Échéance') }), b);
        return send(res, 201, { invoice: await billing.issueInvoice(actor, p.order_id, p) });
      }
      case 'invoice_cancel': {
        const p = s.parse(z.object({ id: id('Facture'), reason: s.text('Motif', { min: 3, max: 300, req: true }) }), b);
        return send(res, 200, { invoice: await billing.cancelInvoice(actor, p.id, p.reason) });
      }
      case 'attendance': {
        const p = s.parse(z.object({
          session_id: id('Session'),
          day: s.date('Jour', { req: true }),
          marks: s.list(z.object({ enrollment_id: id('Apprenant'), status: z.enum(learning.ATTENDANCE).nullable(), note: s.text('Note', { max: 300 }) }), 'Présences', { max: 500 }),
        }), b);
        return send(res, 200, await learning.markAttendance(actor, p.session_id, p.day, p.marks));
      }
      case 'result': {
        const p = s.parse(z.object({ enrollment_id: id('Inscription'), result: z.enum(['reussi', 'non_reussi']).nullable() }), b);
        return send(res, 200, await learning.setResult(actor, p.enrollment_id, p.result));
      }
      case 'certificate': {
        const p = s.parse(z.object({ enrollment_id: id('Inscription'), confirm: z.boolean().default(false), note: s.text('Note', { max: 500 }) }), b);
        return send(res, 201, { certificate: await learning.issueCertificate(actor, p.enrollment_id, p) });
      }
      case 'certificate_revoke': {
        const p = s.parse(z.object({ id: id('Attestation'), reason: s.text('Motif', { min: 3, max: 300, req: true }) }), b);
        return send(res, 200, await learning.revokeCertificate(actor, p.id, p.reason));
      }
      default:
        throw new HttpError(400, 'Action inconnue.');
    }
  },
});
