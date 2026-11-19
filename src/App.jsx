import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AppContext } from './context.js';
import { auth } from './lib/api.js';
import { usePath, navigate, scrollToHash } from './lib/router.jsx';
import { useSeo } from './lib/seo.js';
import { MediaProvider } from './lib/media.jsx';
import { CatalogProvider, useCatalog } from './lib/catalog.jsx';
import { Header, Footer, WhatsAppButton } from './components/Layout.jsx';
import Modal from './components/Modal.jsx';
import { QuoteForm, AuthForm, NewPasswordForm } from './components/forms.jsx';
import { applySettings } from './config.js';
import { Home, Contact, MentionsLegales, Confidentialite, VerifyCertificate } from './pages/public.jsx';
import { PrestationsIndex, PrestationPage } from './pages/prestations.jsx';
import { TrainingCenter, CoursePage } from './pages/formations.jsx';
import { Realisations } from './pages/gallery.jsx';
import { About, EmanCars } from './pages/about.jsx';
import { NotFound } from './components/page.jsx';
// L'espace client et administrateur n'est téléchargé qu'à son ouverture : les visiteurs
// du site public ne chargent pas ce code (environ 40 % du JavaScript de l'application).
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));

const PAGES = {
  '/': Home,
  '/prestations': PrestationsIndex,
  '/services': PrestationsIndex, // ancienne adresse, conservée pour les liens déjà partagés
  '/formations': TrainingCenter,
  '/realisations': Realisations,
  '/a-propos': About,
  '/e-man-cars': EmanCars,
  '/contact': Contact,
  '/espace': Dashboard,
  '/mentions-legales': MentionsLegales,
  '/confidentialite': Confidentialite,
  '/verifier': VerifyCertificate,
};

/** Pages à paramètre : /prestations/:slug et /formations/:slug. */
function resolve(path) {
  if (PAGES[path]) return { Page: PAGES[path], dynamic: false };
  const m = path.match(/^\/(prestations|formations)\/([a-z0-9-]+)$/);
  if (m) {
    return { Page: m[1] === 'prestations' ? PrestationPage : CoursePage, props: { slug: m[2] }, dynamic: true };
  }
  return { Page: NotFound, dynamic: false };
}

/** À l'arrivée sur une adresse avec ancre (#pole-web), défile une fois le contenu chargé. */
function HashOnLoad() {
  const { status } = useCatalog();
  useEffect(() => {
    if (status === 'ready' && window.location.hash) scrollToHash(window.location.hash);
  }, [status]);
  return null;
}

export default function App() {
  const path = usePath();
  const route = resolve(path);
  useSeo(route.dynamic ? null : path);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [modal, setModal] = useState(null); // { type: 'quote' | 'auth' | 'password', service?, token? }
  const [toast, setToast] = useState(null);

  const [methods, setMethods] = useState({ google: false, mail: false });
  // Coordonnées modifiées dans l'admin : appliquées à tout le site (re-rendu complet).
  const [, setContentVersion] = useState(0);
  const applyBusiness = useCallback((content) => {
    if (applySettings(content)) setContentVersion((v) => v + 1);
  }, []);
  const notify = useCallback((text, kind = 'ok') => {
    setToast({ text, kind, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Session en cours + liens reçus par e-mail (/espace?verifier=… ou ?reinitialiser=…)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get('verifier');
    const resetToken = params.get('reinitialiser');
    const google = params.get('connexion');
    if (verifyToken || resetToken || google) navigate(window.location.pathname, { replace: true });

    (async () => {
      try {
        if (verifyToken) {
          const r = await auth.verify({ token: verifyToken });
          setUser(r.user);
          notify(r.claimed ? `Adresse confirmée. ${r.claimed} demande(s) ajoutée(s) à votre espace.` : 'Adresse e-mail confirmée.');
        } else {
          const r = await auth.me();
          setUser(r.user);
          setMethods({ google: Boolean(r.google), mail: Boolean(r.mail) });
          if (google === 'google' && r.user) notify('Vous êtes connecté avec Google.');
          if (google === 'google-echec') notify('La connexion avec Google n’a pas abouti. Réessayez, ou connectez-vous avec votre e-mail.', 'error');
        }
      } catch (e) {
        notify(e.message, 'error');
      } finally {
        setReady(true);
      }
      if (resetToken) setModal({ type: 'password', token: resetToken });
    })();
  }, [notify]);

  const closeModal = useCallback(() => setModal(null), []);

  const ctx = useMemo(() => ({
    user,
    setUser,
    ready,
    methods,
    notify,
    openQuote: (service = '') => setModal({ type: 'quote', service }),
    openAuth: () => setModal({ type: 'auth' }),
    logout: async () => {
      try { await auth.logout(); } catch { /* la session expirera d'elle-même */ }
      setUser(null);
      navigate('/');
      notify('Vous êtes déconnecté.');
    },
  }), [user, ready, notify, methods]);

  const onAuthenticated = (u) => {
    setUser(u);
    setModal(null);
    navigate('/espace');
  };

  const { Page } = route;
  const labels = { quote: 'Demander un devis', auth: 'Espace client', password: 'Nouveau mot de passe' };

  return (
    <AppContext.Provider value={ctx}>
      <CatalogProvider onContent={applyBusiness}>
      <MediaProvider>
      <HashOnLoad />
      <Header />
      <div className="page">
        <Suspense fallback={<main id="contenu" className="space" aria-busy="true"><p className="wrap muted" style={{ padding: '48px 0' }}>Chargement de votre espace…</p></main>}>
          <Page key={path} {...route.props} />
        </Suspense>
      </div>
      <Footer />
      <WhatsAppButton />

      {modal && (
        <Modal label={labels[modal.type]} onClose={closeModal}>
          {(close) => (
            <>
              {modal.type === 'quote' && <QuoteForm initialService={modal.service} onClose={close} intro="Décrivez votre projet : nous vous rappelons avec un prix et un délai." />}
              {modal.type === 'auth' && (
                <AuthForm
                  notify={notify}
                  google={methods.google}
                  onDone={onAuthenticated}
                  startDemo={() => onAuthenticated(auth.demoUser())}
                />
              )}
              {modal.type === 'password' && <NewPasswordForm token={modal.token} notify={notify} onDone={onAuthenticated} />}
            </>
          )}
        </Modal>
      )}

      <div className="toastZone" aria-live="polite">
        {toast && <div key={toast.id} className={`toast ${toast.kind}`}>{toast.text}</div>}
      </div>
      </MediaProvider>
      </CatalogProvider>
    </AppContext.Provider>
  );
}
