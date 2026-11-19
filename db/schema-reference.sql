-- E-MAN PROD — schéma complet après les migrations (référence, généré par pg_dump).
-- NE PAS EXÉCUTER : la base se crée et se met à jour avec `npm run db:migrate`.

-- PostgreSQL database dump
\restrict Ehqu5lMpg0tbMoQUUaN6QrtlpJEEhILEuW0O3afwpEFlZkx4IX54WNtBXelUENn
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';
CREATE FUNCTION public.next_number(prefix text) RETURNS text
    LANGUAGE sql
    AS $$
  insert into counters (key, value) values (prefix || '-' || to_char(now(), 'YYYY'), 1)
  on conflict (key) do update set value = counters.value + 1
  returning prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(value::text, 5, '0');
$$;
CREATE FUNCTION public.recalc_order_total() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare oid uuid := coalesce(new.order_id, old.order_id);
begin
  update orders set subtotal_fcfa = coalesce((select sum(line_total_fcfa) from order_items where order_id = oid), 0)
   where id = oid;
  return null;
end;
$$;
CREATE FUNCTION public.recalc_quote_total() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare qid uuid := coalesce(new.quote_id, old.quote_id);
begin
  update quotes set subtotal_fcfa = coalesce((select sum(line_total_fcfa) from quote_items where quote_id = qid), 0)
   where id = qid;
  if tg_op = 'UPDATE' and old.quote_id is distinct from new.quote_id then
    update quotes set subtotal_fcfa = coalesce((select sum(line_total_fcfa) from quote_items where quote_id = old.quote_id), 0)
     where id = old.quote_id;
  end if;
  return null;
end;
$$;
CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;
CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    provider_account_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT accounts_provider_check CHECK ((provider ~ '^[a-z0-9-]{2,40}$'::text))
);
CREATE TABLE public.activity_logs (
    id bigint NOT NULL,
    actor_id uuid,
    actor_role text,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT activity_logs_action_check CHECK ((action ~ '^[a-z_]+(\.[a-z_]+)+$'::text)),
    CONSTRAINT activity_logs_actor_role_check CHECK ((actor_role = ANY (ARRAY['client'::text, 'admin'::text, 'system'::text, 'guest'::text])))
);
ALTER TABLE public.activity_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.activity_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE public.client_profiles (
    user_id uuid NOT NULL,
    client_type text DEFAULT 'particulier'::text NOT NULL,
    company_name text,
    address text,
    city text,
    whatsapp text,
    preferred_contact text DEFAULT 'whatsapp'::text NOT NULL,
    admin_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_profiles_address_check CHECK (((address IS NULL) OR (length(address) <= 300))),
    CONSTRAINT client_profiles_city_check CHECK (((city IS NULL) OR (length(city) <= 120))),
    CONSTRAINT client_profiles_client_type_check CHECK ((client_type = ANY (ARRAY['particulier'::text, 'entreprise'::text, 'association'::text, 'etablissement'::text]))),
    CONSTRAINT client_profiles_company_name_check CHECK (((company_name IS NULL) OR (length(company_name) <= 160))),
    CONSTRAINT client_profiles_preferred_contact_check CHECK ((preferred_contact = ANY (ARRAY['whatsapp'::text, 'appel'::text, 'email'::text]))),
    CONSTRAINT client_profiles_whatsapp_check CHECK (((whatsapp IS NULL) OR (whatsapp ~ '^\+[0-9]{8,15}$'::text)))
);
CREATE TABLE public.counters (
    key text NOT NULL,
    value bigint NOT NULL
);
CREATE TABLE public.enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    full_name text NOT NULL,
    phone text NOT NULL,
    email text,
    training_title text NOT NULL,
    message text,
    status text DEFAULT 'Nouvelle demande'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    training_slug text,
    session_id uuid,
    admin_note text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT enrollments_status_check CHECK ((status = ANY (ARRAY['Nouvelle demande'::text, 'Contacté'::text, 'Inscrit'::text, 'Terminé'::text, 'Annulé'::text])))
);
CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    invoice_number text NOT NULL,
    customer_name text NOT NULL,
    amount numeric(12,0) DEFAULT 0 NOT NULL,
    status text DEFAULT 'Brouillon'::text NOT NULL,
    due_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    legacy_order_id uuid,
    CONSTRAINT invoices_status_check CHECK ((status = ANY (ARRAY['Brouillon'::text, 'Émise'::text, 'Payée'::text, 'En retard'::text, 'Annulée'::text])))
);
CREATE TABLE public.legacy_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference text DEFAULT ('EMP-'::text || upper(substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 8))) NOT NULL,
    user_id uuid,
    customer_name text NOT NULL,
    customer_email text,
    phone text NOT NULL,
    service text NOT NULL,
    details text NOT NULL,
    quantity text,
    status text DEFAULT 'En attente'::text NOT NULL,
    total_amount numeric(12,0),
    payment_status text DEFAULT 'Non payé'::text NOT NULL,
    admin_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['Non payé'::text, 'Acompte payé'::text, 'Payé'::text]))),
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['En attente'::text, 'Devis envoyé'::text, 'Validée'::text, 'En production'::text, 'Terminée'::text, 'Annulée'::text]))),
    CONSTRAINT orders_total_amount_check CHECK (((total_amount IS NULL) OR (total_amount >= (0)::numeric)))
);
COMMENT ON TABLE public.legacy_orders IS 'Demandes reçues avant la v2.5 (lecture seule). Recopiées dans quotes et orders par la migration 002.';
CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quote_id uuid,
    order_id uuid,
    author_id uuid,
    author_role text NOT NULL,
    body text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_author_role_check CHECK ((author_role = ANY (ARRAY['client'::text, 'admin'::text]))),
    CONSTRAINT messages_body_check CHECK (((length(body) >= 1) AND (length(body) <= 4000))),
    CONSTRAINT messages_check CHECK ((num_nonnulls(quote_id, order_id) = 1))
);
CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_kind_check CHECK ((kind ~ '^[a-z_]+(\.[a-z_]+)*$'::text)),
    CONSTRAINT notifications_link_check CHECK (((link IS NULL) OR (link ~ '^/'::text)))
);
CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    quote_item_id uuid,
    service_slug text,
    label text NOT NULL,
    description text,
    quantity numeric(12,2) DEFAULT 1 NOT NULL,
    unit text,
    unit_price_fcfa bigint,
    line_total_fcfa bigint GENERATED ALWAYS AS ((round((quantity * (unit_price_fcfa)::numeric)))::bigint) STORED,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_items_label_check CHECK (((length(label) >= 2) AND (length(label) <= 160))),
    CONSTRAINT order_items_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT order_items_unit_price_fcfa_check CHECK (((unit_price_fcfa IS NULL) OR (unit_price_fcfa >= 0)))
);
CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text DEFAULT public.next_number('CMD'::text) NOT NULL,
    quote_id uuid,
    user_id uuid,
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    customer_email text,
    status text DEFAULT 'confirmee'::text NOT NULL,
    payment_status text DEFAULT 'non_paye'::text NOT NULL,
    amount_paid_fcfa bigint DEFAULT 0 NOT NULL,
    subtotal_fcfa bigint DEFAULT 0 NOT NULL,
    discount_fcfa bigint DEFAULT 0 NOT NULL,
    total_fcfa bigint GENERATED ALWAYS AS (GREATEST((subtotal_fcfa - discount_fcfa), (0)::bigint)) STORED,
    due_on date,
    delivered_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    admin_note text,
    legacy_order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orders_amount_paid_fcfa_check CHECK ((amount_paid_fcfa >= 0)),
    CONSTRAINT orders_customer_name_check CHECK (((length(customer_name) >= 2) AND (length(customer_name) <= 120))),
    CONSTRAINT orders_discount_fcfa_check CHECK ((discount_fcfa >= 0)),
    CONSTRAINT orders_payment_status_check1 CHECK ((payment_status = ANY (ARRAY['non_paye'::text, 'acompte'::text, 'paye'::text]))),
    CONSTRAINT orders_status_check1 CHECK ((status = ANY (ARRAY['confirmee'::text, 'en_production'::text, 'terminee'::text, 'livree'::text, 'annulee'::text])))
);
CREATE TABLE public.portfolio_categories (
    slug text NOT NULL,
    title text NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    CONSTRAINT portfolio_categories_slug_check CHECK ((slug ~ '^[a-z0-9-]{2,60}$'::text))
);
CREATE TABLE public.portfolio_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_slug text NOT NULL,
    title text NOT NULL,
    description text,
    image_url text NOT NULL,
    alt text NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'publie'::text NOT NULL,
    published_at timestamp with time zone,
    service_slug text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image_file_id uuid,
    CONSTRAINT portfolio_items_published_check CHECK (((status <> 'publie'::text) OR (published_at IS NOT NULL))),
    CONSTRAINT portfolio_items_status_check CHECK ((status = ANY (ARRAY['brouillon'::text, 'publie'::text, 'masque'::text])))
);
CREATE TABLE public.quote_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quote_id uuid NOT NULL,
    service_slug text,
    label text NOT NULL,
    description text,
    quantity numeric(12,2) DEFAULT 1 NOT NULL,
    unit text,
    unit_price_fcfa bigint,
    line_total_fcfa bigint GENERATED ALWAYS AS ((round((quantity * (unit_price_fcfa)::numeric)))::bigint) STORED,
    sort integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quote_items_label_check CHECK (((length(label) >= 2) AND (length(label) <= 160))),
    CONSTRAINT quote_items_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT quote_items_unit_price_fcfa_check CHECK (((unit_price_fcfa IS NULL) OR (unit_price_fcfa >= 0)))
);
CREATE TABLE public.quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text DEFAULT public.next_number('DV'::text) NOT NULL,
    user_id uuid,
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    customer_email text,
    customer_company text,
    message text,
    status text DEFAULT 'nouveau'::text NOT NULL,
    source text DEFAULT 'site'::text NOT NULL,
    subtotal_fcfa bigint DEFAULT 0 NOT NULL,
    discount_fcfa bigint DEFAULT 0 NOT NULL,
    total_fcfa bigint GENERATED ALWAYS AS (GREATEST((subtotal_fcfa - discount_fcfa), (0)::bigint)) STORED,
    valid_until date,
    admin_note text,
    sent_at timestamp with time zone,
    decided_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    legacy_order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quotes_customer_name_check CHECK (((length(customer_name) >= 2) AND (length(customer_name) <= 120))),
    CONSTRAINT quotes_discount_fcfa_check CHECK ((discount_fcfa >= 0)),
    CONSTRAINT quotes_source_check CHECK ((source = ANY (ARRAY['site'::text, 'whatsapp'::text, 'telephone'::text, 'atelier'::text, 'admin'::text]))),
    CONSTRAINT quotes_status_check CHECK ((status = ANY (ARRAY['nouveau'::text, 'en_etude'::text, 'envoye'::text, 'accepte'::text, 'refuse'::text, 'expire'::text, 'annule'::text])))
);
CREATE TABLE public.rate_events (
    bucket text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.schema_migrations (
    version text NOT NULL,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.services (
    slug text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    intro text DEFAULT ''::text NOT NULL,
    offerings jsonb DEFAULT '[]'::jsonb NOT NULL,
    placeholder text,
    related_category_slug text,
    sort integer DEFAULT 0 NOT NULL,
    published boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prestations_slug_check CHECK ((slug ~ '^[a-z0-9-]{2,60}$'::text))
);
CREATE TABLE public.sessions (
    token_hash text NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.site_media (
    slot text NOT NULL,
    url text NOT NULL,
    alt text DEFAULT ''::text NOT NULL,
    credit text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    file_id uuid,
    CONSTRAINT site_media_slot_check CHECK ((slot ~ '^[a-z0-9-]{2,60}$'::text))
);
CREATE TABLE public.site_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT content_blocks_key_check CHECK ((key ~ '^[a-z0-9-]{2,60}$'::text))
);
CREATE TABLE public.testimonials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    author_name text NOT NULL,
    author_title text,
    content text NOT NULL,
    rating smallint,
    service_slug text,
    status text DEFAULT 'en_attente'::text NOT NULL,
    consent_at timestamp with time zone NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT testimonials_author_name_check CHECK (((length(author_name) >= 2) AND (length(author_name) <= 120))),
    CONSTRAINT testimonials_author_title_check CHECK (((author_title IS NULL) OR (length(author_title) <= 120))),
    CONSTRAINT testimonials_check CHECK (((status <> 'publie'::text) OR (published_at IS NOT NULL))),
    CONSTRAINT testimonials_content_check CHECK (((length(content) >= 10) AND (length(content) <= 1000))),
    CONSTRAINT testimonials_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT testimonials_status_check CHECK ((status = ANY (ARRAY['en_attente'::text, 'publie'::text, 'refuse'::text])))
);
CREATE TABLE public.training_categories (
    slug text NOT NULL,
    number integer NOT NULL,
    title text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    sort integer DEFAULT 0 NOT NULL,
    CONSTRAINT training_poles_slug_check CHECK ((slug ~ '^[a-z0-9-]{2,60}$'::text))
);
CREATE TABLE public.training_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    training_slug text NOT NULL,
    starts_on date NOT NULL,
    ends_on date,
    schedule text,
    site text,
    seats integer,
    status text DEFAULT 'ouverte'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT training_sessions_check CHECK (((ends_on IS NULL) OR (ends_on >= starts_on))),
    CONSTRAINT training_sessions_seats_check CHECK (((seats IS NULL) OR (seats > 0))),
    CONSTRAINT training_sessions_status_check CHECK ((status = ANY (ARRAY['ouverte'::text, 'fermée'::text])))
);
CREATE TABLE public.trainings (
    slug text NOT NULL,
    category_slug text NOT NULL,
    title text NOT NULL,
    domain text NOT NULL,
    summary text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    objectives jsonb DEFAULT '[]'::jsonb NOT NULL,
    program jsonb DEFAULT '[]'::jsonb NOT NULL,
    duration text,
    level text,
    prerequisites text,
    price_fcfa integer,
    price_note text,
    certificate text,
    placeholder text,
    sort integer DEFAULT 0 NOT NULL,
    published boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT courses_price_fcfa_check CHECK (((price_fcfa IS NULL) OR (price_fcfa >= 0))),
    CONSTRAINT courses_slug_check CHECK ((slug ~ '^[a-z0-9-]{2,60}$'::text))
);
CREATE TABLE public.uploaded_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid,
    purpose text NOT NULL,
    driver text NOT NULL,
    storage_key text NOT NULL,
    original_name text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    quote_id uuid,
    order_id uuid,
    message_id uuid,
    portfolio_item_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed_at timestamp with time zone,
    CONSTRAINT uploaded_files_check CHECK ((num_nonnulls(quote_id, order_id, message_id, portfolio_item_id) <= 1)),
    CONSTRAINT uploaded_files_driver_check CHECK ((driver = ANY (ARRAY['s3'::text, 'local'::text]))),
    CONSTRAINT uploaded_files_original_name_check CHECK (((length(original_name) >= 1) AND (length(original_name) <= 200))),
    CONSTRAINT uploaded_files_purpose_check CHECK ((purpose = ANY (ARRAY['quote'::text, 'order'::text, 'message'::text, 'portfolio'::text, 'site_media'::text]))),
    CONSTRAINT uploaded_files_size_bytes_check CHECK (((size_bytes > 0) AND (size_bytes <= 26214400))),
    CONSTRAINT uploaded_files_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'rejected'::text]))),
    CONSTRAINT uploaded_files_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'public'::text])))
);
CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    full_name text NOT NULL,
    phone text,
    role text DEFAULT 'client'::text NOT NULL,
    email_verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['client'::text, 'admin'::text])))
);
CREATE TABLE public.verification_tokens (
    token_hash text NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auth_tokens_kind_check CHECK ((kind = ANY (ARRAY['verify'::text, 'reset'::text])))
);
ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_provider_provider_account_id_key UNIQUE (provider, provider_account_id);
ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.client_profiles
    ADD CONSTRAINT client_profiles_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.counters
    ADD CONSTRAINT counters_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.legacy_orders
    ADD CONSTRAINT legacy_orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.legacy_orders
    ADD CONSTRAINT legacy_orders_reference_key UNIQUE (reference);
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_legacy_order_id_key UNIQUE (legacy_order_id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_number_key UNIQUE (number);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.portfolio_categories
    ADD CONSTRAINT portfolio_categories_pkey PRIMARY KEY (slug);
ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.quote_items
    ADD CONSTRAINT quote_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_legacy_order_id_key UNIQUE (legacy_order_id);
ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_number_key UNIQUE (number);
ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);
ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (slug);
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (token_hash);
ALTER TABLE ONLY public.site_media
    ADD CONSTRAINT site_media_pkey PRIMARY KEY (slot);
ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.testimonials
    ADD CONSTRAINT testimonials_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.training_categories
    ADD CONSTRAINT training_categories_pkey PRIMARY KEY (slug);
ALTER TABLE ONLY public.training_sessions
    ADD CONSTRAINT training_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.trainings
    ADD CONSTRAINT trainings_pkey PRIMARY KEY (slug);
ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_storage_key_key UNIQUE (storage_key);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.verification_tokens
    ADD CONSTRAINT verification_tokens_pkey PRIMARY KEY (token_hash);
CREATE INDEX accounts_user_idx ON public.accounts USING btree (user_id);
CREATE INDEX activity_actor_idx ON public.activity_logs USING btree (actor_id, created_at DESC);
CREATE INDEX activity_entity_idx ON public.activity_logs USING btree (entity_type, entity_id, created_at DESC);
CREATE INDEX enrollments_email_idx ON public.enrollments USING btree (lower(email));
CREATE INDEX enrollments_session_idx ON public.enrollments USING btree (session_id);
CREATE INDEX enrollments_status_idx ON public.enrollments USING btree (session_id, status);
CREATE INDEX enrollments_user_idx ON public.enrollments USING btree (user_id);
CREATE INDEX files_message_idx ON public.uploaded_files USING btree (message_id) WHERE (message_id IS NOT NULL);
CREATE INDEX files_order_idx ON public.uploaded_files USING btree (order_id) WHERE (order_id IS NOT NULL);
CREATE INDEX files_owner_idx ON public.uploaded_files USING btree (owner_id, created_at DESC);
CREATE INDEX files_pending_idx ON public.uploaded_files USING btree (created_at) WHERE (status = 'pending'::text);
CREATE INDEX files_quote_idx ON public.uploaded_files USING btree (quote_id) WHERE (quote_id IS NOT NULL);
CREATE INDEX legacy_orders_created_idx ON public.legacy_orders USING btree (created_at DESC);
CREATE INDEX legacy_orders_email_idx ON public.legacy_orders USING btree (lower(customer_email));
CREATE INDEX legacy_orders_user_idx ON public.legacy_orders USING btree (user_id);
CREATE INDEX messages_order_idx ON public.messages USING btree (order_id, created_at) WHERE (order_id IS NOT NULL);
CREATE INDEX messages_quote_idx ON public.messages USING btree (quote_id, created_at) WHERE (quote_id IS NOT NULL);
CREATE INDEX notifications_unread_idx ON public.notifications USING btree (user_id) WHERE (read_at IS NULL);
CREATE INDEX notifications_user_idx ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX order_items_order_idx ON public.order_items USING btree (order_id, sort);
CREATE INDEX order_items_service_idx ON public.order_items USING btree (service_slug);
CREATE UNIQUE INDEX orders_quote_key ON public.orders USING btree (quote_id) WHERE (quote_id IS NOT NULL);
CREATE INDEX orders_status_idx ON public.orders USING btree (status, created_at DESC);
CREATE INDEX orders_user_idx ON public.orders USING btree (user_id, created_at DESC);
CREATE INDEX portfolio_items_listing_idx ON public.portfolio_items USING btree (status, category_slug, sort);
CREATE INDEX quote_items_quote_idx ON public.quote_items USING btree (quote_id, sort);
CREATE INDEX quote_items_service_idx ON public.quote_items USING btree (service_slug);
CREATE INDEX quotes_email_idx ON public.quotes USING btree (lower(customer_email));
CREATE INDEX quotes_phone_idx ON public.quotes USING btree (customer_phone);
CREATE INDEX quotes_status_idx ON public.quotes USING btree (status, created_at DESC);
CREATE INDEX quotes_user_idx ON public.quotes USING btree (user_id, created_at DESC);
CREATE INDEX rate_events_bucket_idx ON public.rate_events USING btree (bucket, created_at DESC);
CREATE INDEX sessions_expires_idx ON public.sessions USING btree (expires_at);
CREATE INDEX sessions_user_idx ON public.sessions USING btree (user_id);
CREATE INDEX testimonials_status_idx ON public.testimonials USING btree (status, published_at DESC);
CREATE INDEX training_sessions_training_idx ON public.training_sessions USING btree (training_slug, starts_on);
CREATE INDEX trainings_category_idx ON public.trainings USING btree (category_slug, sort);
CREATE UNIQUE INDEX users_email_key ON public.users USING btree (lower(email));
CREATE INDEX verification_tokens_user_idx ON public.verification_tokens USING btree (user_id);
CREATE TRIGGER client_profiles_touch_updated_at BEFORE UPDATE ON public.client_profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER enrollments_touch_updated_at BEFORE UPDATE ON public.enrollments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER order_items_total AFTER INSERT OR DELETE OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.recalc_order_total();
CREATE TRIGGER orders_touch_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER portfolio_items_touch_updated_at BEFORE UPDATE ON public.portfolio_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER quote_items_total AFTER INSERT OR DELETE OR UPDATE ON public.quote_items FOR EACH ROW EXECUTE FUNCTION public.recalc_quote_total();
CREATE TRIGGER quotes_touch_updated_at BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER training_sessions_touch_updated_at BEFORE UPDATE ON public.training_sessions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.verification_tokens
    ADD CONSTRAINT auth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.client_profiles
    ADD CONSTRAINT client_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_training_slug_fkey FOREIGN KEY (training_slug) REFERENCES public.trainings(slug) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_legacy_order_id_fkey FOREIGN KEY (legacy_order_id) REFERENCES public.legacy_orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_quote_item_id_fkey FOREIGN KEY (quote_item_id) REFERENCES public.quote_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_service_slug_fkey FOREIGN KEY (service_slug) REFERENCES public.services(slug) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_legacy_order_id_fkey FOREIGN KEY (legacy_order_id) REFERENCES public.legacy_orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.legacy_orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey1 FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_category_fkey FOREIGN KEY (category_slug) REFERENCES public.portfolio_categories(slug) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_image_file_id_fkey FOREIGN KEY (image_file_id) REFERENCES public.uploaded_files(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.portfolio_items
    ADD CONSTRAINT portfolio_items_service_slug_fkey FOREIGN KEY (service_slug) REFERENCES public.services(slug) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.quote_items
    ADD CONSTRAINT quote_items_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.quote_items
    ADD CONSTRAINT quote_items_service_slug_fkey FOREIGN KEY (service_slug) REFERENCES public.services(slug) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_legacy_order_id_fkey FOREIGN KEY (legacy_order_id) REFERENCES public.legacy_orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_related_category_fkey FOREIGN KEY (related_category_slug) REFERENCES public.training_categories(slug) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.site_media
    ADD CONSTRAINT site_media_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.uploaded_files(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.site_media
    ADD CONSTRAINT site_media_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.testimonials
    ADD CONSTRAINT testimonials_service_slug_fkey FOREIGN KEY (service_slug) REFERENCES public.services(slug) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.testimonials
    ADD CONSTRAINT testimonials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT training_registrations_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.training_sessions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT training_registrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.training_sessions
    ADD CONSTRAINT training_sessions_training_slug_fkey FOREIGN KEY (training_slug) REFERENCES public.trainings(slug) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.trainings
    ADD CONSTRAINT trainings_category_slug_fkey FOREIGN KEY (category_slug) REFERENCES public.training_categories(slug) ON UPDATE CASCADE;
ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_portfolio_item_id_fkey FOREIGN KEY (portfolio_item_id) REFERENCES public.portfolio_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON DELETE RESTRICT;
-- PostgreSQL database dump complete
\unrestrict Ehqu5lMpg0tbMoQUUaN6QrtlpJEEhILEuW0O3afwpEFlZkx4IX54WNtBXelUENn
