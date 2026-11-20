// Notifications push sur cet appareil et liste des appareils abonnés du compte.
import React, { useEffect, useState } from 'react';
import { BellRing, BellOff, Smartphone, Trash2 } from 'lucide-react';
import { useLoad, Loading, ErrorBox } from './ui.jsx';
import { DEMO, formatDate } from '../../lib/api.js';
import { pushSupported, needsHomeScreen, pushApi, enablePush, disablePush, currentSubscription } from '../../lib/push.js';

export function PushSettings({ notify, team = false }) {
  const [{ data, error }, reload] = useLoad(() => (DEMO ? Promise.resolve({ configured: false, devices: [] }) : pushApi.status()), []);
  const [here, setHere] = useState(null); // abonnement de cet appareil
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();
  const blocked = supported && Notification.permission === 'denied';

  useEffect(() => { currentSubscription().then(setHere).catch(() => setHere(null)); }, [data]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading lines={2} />;
  const thisDevice = here && data.devices.find((d) => here.endpoint.endsWith(d.endpoint_hint));
  const on = Boolean(thisDevice);

  async function toggle() {
    setBusy(true);
    try {
      if (on) { await disablePush(); notify('Notifications désactivées sur cet appareil.'); }
      else { await enablePush(data.public_key); notify('Notifications activées sur cet appareil.'); }
      await reload();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    try {
      const r = await pushApi.test();
      notify(r.sent ? `Notification d’essai envoyée à ${r.sent} appareil${r.sent > 1 ? 's' : ''}.` : 'L’envoi n’a pas abouti. Réactivez les notifications sur cet appareil.', r.sent ? undefined : 'error');
      await reload();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function remove(d) {
    setBusy(true);
    try {
      if (thisDevice?.id === d.id) await disablePush(); else await pushApi.remove(d.id);
      notify('Appareil retiré : il ne recevra plus de notifications.');
      await reload();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="spaceBlock pushSettings" aria-labelledby="push-title">
      <h2 className="subTitle" id="push-title">Notifications sur vos appareils</h2>
      <p className="muted">
        {team
          ? 'Recevez une alerte sur ce téléphone ou cet ordinateur, même site fermé : nouvelle commande, demande de devis, message d’un client…'
          : 'Recevez une alerte sur ce téléphone ou cet ordinateur, même site fermé : devis prêt, commande confirmée ou prête, message de l’équipe…'}
        {' '}Le texte affiché reste discret (aucun nom ni montant) ; le détail s’ouvre dans votre espace.
      </p>
      {DEMO ? <p className="notice">Indisponible en mode démonstration.</p>
        : !data.configured ? <p className="notice" role="status">Les notifications push ne sont pas encore prêtes sur le serveur. {data.error || ''}</p>
          : !supported ? (
            needsHomeScreen()
              ? <p className="notice">Sur iPhone et iPad : touchez <strong>Partager</strong> puis <strong>Sur l’écran d’accueil</strong>, ouvrez E-MAN PROD depuis cette icône, puis revenez ici pour activer les notifications (iOS 16.4 ou plus récent).</p>
              : <p className="notice">Ce navigateur ne permet pas les notifications push. Essayez Chrome, Edge, Firefox ou Safari à jour.</p>
          ) : (
            <>
              {blocked && !on && <p className="notice" role="status">Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur (icône à gauche de l’adresse), puis réessayez.</p>}
              <div className="pushActions">
                <button type="button" className={`btn btnSmall ${on ? 'btnGhost' : 'btnPrimary'}`} disabled={busy} onClick={toggle} aria-pressed={on}>
                  {on ? <><BellOff size={16} aria-hidden="true" /> Désactiver sur cet appareil</> : <><BellRing size={16} aria-hidden="true" /> Activer sur cet appareil</>}
                </button>
                {data.devices.length > 0 && <button type="button" className="btn btnGhost btnSmall" disabled={busy} onClick={test}>Envoyer une notification d’essai</button>}
              </div>
            </>
          )}
      {data.devices.length > 0 && (
        <ul className="deviceList" aria-label="Appareils qui reçoivent les notifications">
          {data.devices.map((d) => (
            <li key={d.id}>
              <Smartphone size={16} aria-hidden="true" />
              <span><strong>{d.device_label || 'Appareil'}</strong>{thisDevice?.id === d.id && <span className="tag new">cet appareil</span>}
                <small className="muted"> · activé le {formatDate(d.created_at)}{d.failures > 0 ? ' · envois en échec récemment' : ''}</small></span>
              <button type="button" className="iconBtn" disabled={busy} onClick={() => remove(d)} aria-label={`Retirer ${d.device_label || 'cet appareil'}`}><Trash2 size={16} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
