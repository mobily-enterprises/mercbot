// Mercbot's schema, created at once: every table Mercbot's own code keeps, with its sequences, defaults, keys and
// indexes; its functions and trigger; the columns, keys and indexes it adds to the agent engine's tables; the foreign
// keys; and the usage tables' first partitions. JSKIT's packages create their own tables before this migration, and
// the packages' constraints/ migrations run after it. It is the whole history before it, squashed: each later change
// is a new migration after this one.

const TABLES = String.raw`
CREATE TABLE public.any_field_configs (
    id integer NOT NULL,
    resource_config_id integer NOT NULL,
    field_name character varying(255) NOT NULL,
    slot_type character varying(255) NOT NULL,
    slot_index integer NOT NULL,
    slot_column character varying(255) NOT NULL,
    nullable boolean DEFAULT false NOT NULL,
    required boolean DEFAULT false NOT NULL,
    target_resource character varying(255),
    alias character varying(255),
    meta_json text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.any_field_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.any_field_configs_id_seq OWNED BY public.any_field_configs.id;
ALTER TABLE ONLY public.any_field_configs ALTER COLUMN id SET DEFAULT nextval('public.any_field_configs_id_seq'::regclass);
ALTER TABLE ONLY public.any_field_configs
    ADD CONSTRAINT any_field_configs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.any_field_configs
    ADD CONSTRAINT any_field_configs_resource_config_id_field_name_unique UNIQUE (resource_config_id, field_name);
ALTER TABLE ONLY public.any_field_configs
    ADD CONSTRAINT any_field_configs_resource_slot_unique UNIQUE (resource_config_id, slot_column);
CREATE INDEX any_field_configs_resource_config_id_index ON public.any_field_configs USING btree (resource_config_id);

CREATE TABLE public.any_links (
    id integer NOT NULL,
    tenant_id character varying(255) NOT NULL,
    relationship character varying(255) NOT NULL,
    inverse_relationship character varying(255),
    left_resource character varying(255) NOT NULL,
    left_id character varying(255) NOT NULL,
    right_resource character varying(255) NOT NULL,
    right_id character varying(255) NOT NULL,
    payload text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.any_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.any_links_id_seq OWNED BY public.any_links.id;
ALTER TABLE ONLY public.any_links ALTER COLUMN id SET DEFAULT nextval('public.any_links_id_seq'::regclass);
ALTER TABLE ONLY public.any_links
    ADD CONSTRAINT any_links_pkey PRIMARY KEY (id);
CREATE INDEX any_links_inverse_relationship_index ON public.any_links USING btree (inverse_relationship);
CREATE INDEX any_links_relationship_index ON public.any_links USING btree (relationship);
CREATE INDEX any_links_tenant_id_inverse_relationship_index ON public.any_links USING btree (tenant_id, inverse_relationship);
CREATE INDEX any_links_tenant_id_left_resource_index ON public.any_links USING btree (tenant_id, left_resource);
CREATE INDEX any_links_tenant_id_relationship_index ON public.any_links USING btree (tenant_id, relationship);
CREATE INDEX any_links_tenant_id_right_resource_index ON public.any_links USING btree (tenant_id, right_resource);
CREATE INDEX any_links_tenant_left_id_idx ON public.any_links USING btree (tenant_id, left_id);
CREATE INDEX any_links_tenant_right_id_idx ON public.any_links USING btree (tenant_id, right_id);

CREATE TABLE public.any_records (
    id integer NOT NULL,
    logical_id character varying(255),
    tenant_id character varying(255) NOT NULL,
    resource character varying(255) NOT NULL,
    string_1 text,
    string_2 text,
    string_3 text,
    string_4 text,
    string_5 text,
    string_6 text,
    string_7 text,
    string_8 text,
    string_9 text,
    string_10 text,
    string_11 text,
    string_12 text,
    string_13 text,
    string_14 text,
    string_15 text,
    string_16 text,
    string_17 text,
    string_18 text,
    string_19 text,
    string_20 text,
    string_21 text,
    string_22 text,
    string_23 text,
    string_24 text,
    string_25 text,
    string_26 text,
    string_27 text,
    string_28 text,
    string_29 text,
    string_30 text,
    string_31 text,
    string_32 text,
    string_33 text,
    string_34 text,
    string_35 text,
    string_36 text,
    string_37 text,
    string_38 text,
    string_39 text,
    string_40 text,
    string_41 text,
    string_42 text,
    string_43 text,
    string_44 text,
    string_45 text,
    string_46 text,
    string_47 text,
    string_48 text,
    string_49 text,
    string_50 text,
    string_51 text,
    string_52 text,
    string_53 text,
    string_54 text,
    string_55 text,
    string_56 text,
    string_57 text,
    string_58 text,
    string_59 text,
    string_60 text,
    number_1 double precision,
    number_2 double precision,
    number_3 double precision,
    number_4 double precision,
    number_5 double precision,
    number_6 double precision,
    number_7 double precision,
    number_8 double precision,
    number_9 double precision,
    number_10 double precision,
    number_11 double precision,
    number_12 double precision,
    number_13 double precision,
    number_14 double precision,
    number_15 double precision,
    number_16 double precision,
    number_17 double precision,
    number_18 double precision,
    number_19 double precision,
    number_20 double precision,
    number_21 double precision,
    number_22 double precision,
    number_23 double precision,
    number_24 double precision,
    number_25 double precision,
    number_26 double precision,
    number_27 double precision,
    number_28 double precision,
    number_29 double precision,
    number_30 double precision,
    boolean_1 boolean,
    boolean_2 boolean,
    boolean_3 boolean,
    boolean_4 boolean,
    boolean_5 boolean,
    boolean_6 boolean,
    boolean_7 boolean,
    boolean_8 boolean,
    boolean_9 boolean,
    boolean_10 boolean,
    boolean_11 boolean,
    boolean_12 boolean,
    boolean_13 boolean,
    boolean_14 boolean,
    boolean_15 boolean,
    boolean_16 boolean,
    boolean_17 boolean,
    boolean_18 boolean,
    boolean_19 boolean,
    boolean_20 boolean,
    date_1 timestamp(6) with time zone,
    date_2 timestamp(6) with time zone,
    date_3 timestamp(6) with time zone,
    date_4 timestamp(6) with time zone,
    date_5 timestamp(6) with time zone,
    date_6 timestamp(6) with time zone,
    date_7 timestamp(6) with time zone,
    date_8 timestamp(6) with time zone,
    date_9 timestamp(6) with time zone,
    date_10 timestamp(6) with time zone,
    date_11 timestamp(6) with time zone,
    date_12 timestamp(6) with time zone,
    date_13 timestamp(6) with time zone,
    date_14 timestamp(6) with time zone,
    date_15 timestamp(6) with time zone,
    date_16 timestamp(6) with time zone,
    date_17 timestamp(6) with time zone,
    date_18 timestamp(6) with time zone,
    date_19 timestamp(6) with time zone,
    date_20 timestamp(6) with time zone,
    json_1 text,
    json_2 text,
    json_3 text,
    json_4 text,
    json_5 text,
    json_6 text,
    json_7 text,
    json_8 text,
    json_9 text,
    json_10 text,
    rel_1_id character varying(255),
    rel_1_type character varying(255),
    rel_2_id character varying(255),
    rel_2_type character varying(255),
    rel_3_id character varying(255),
    rel_3_type character varying(255),
    rel_4_id character varying(255),
    rel_4_type character varying(255),
    rel_5_id character varying(255),
    rel_5_type character varying(255),
    rel_6_id character varying(255),
    rel_6_type character varying(255),
    rel_7_id character varying(255),
    rel_7_type character varying(255),
    rel_8_id character varying(255),
    rel_8_type character varying(255),
    rel_9_id character varying(255),
    rel_9_type character varying(255),
    rel_10_id character varying(255),
    rel_10_type character varying(255),
    rel_11_id character varying(255),
    rel_11_type character varying(255),
    rel_12_id character varying(255),
    rel_12_type character varying(255),
    rel_13_id character varying(255),
    rel_13_type character varying(255),
    rel_14_id character varying(255),
    rel_14_type character varying(255),
    rel_15_id character varying(255),
    rel_15_type character varying(255),
    indexed_string_1 character varying(255),
    indexed_string_2 character varying(255),
    indexed_string_3 character varying(255),
    indexed_string_4 character varying(255),
    indexed_string_5 character varying(255),
    indexed_number_1 double precision,
    indexed_number_2 double precision,
    indexed_number_3 double precision,
    indexed_date_1 timestamp(6) with time zone,
    indexed_date_2 timestamp(6) with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);
CREATE SEQUENCE public.any_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.any_records_id_seq OWNED BY public.any_records.id;
ALTER TABLE ONLY public.any_records ALTER COLUMN id SET DEFAULT nextval('public.any_records_id_seq'::regclass);
ALTER TABLE ONLY public.any_records
    ADD CONSTRAINT any_records_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.any_records
    ADD CONSTRAINT any_records_tenant_resource_logical_id_unique UNIQUE (tenant_id, resource, logical_id);
CREATE INDEX any_records_indexed_date_1_idx ON public.any_records USING btree (tenant_id, resource, indexed_date_1);
CREATE INDEX any_records_indexed_date_2_idx ON public.any_records USING btree (tenant_id, resource, indexed_date_2);
CREATE INDEX any_records_indexed_number_1_idx ON public.any_records USING btree (tenant_id, resource, indexed_number_1);
CREATE INDEX any_records_indexed_number_2_idx ON public.any_records USING btree (tenant_id, resource, indexed_number_2);
CREATE INDEX any_records_indexed_number_3_idx ON public.any_records USING btree (tenant_id, resource, indexed_number_3);
CREATE INDEX any_records_indexed_string_1_idx ON public.any_records USING btree (tenant_id, resource, indexed_string_1);
CREATE INDEX any_records_indexed_string_2_idx ON public.any_records USING btree (tenant_id, resource, indexed_string_2);
CREATE INDEX any_records_indexed_string_3_idx ON public.any_records USING btree (tenant_id, resource, indexed_string_3);
CREATE INDEX any_records_indexed_string_4_idx ON public.any_records USING btree (tenant_id, resource, indexed_string_4);
CREATE INDEX any_records_indexed_string_5_idx ON public.any_records USING btree (tenant_id, resource, indexed_string_5);
CREATE INDEX any_records_rel_10_id_idx ON public.any_records USING btree (tenant_id, resource, rel_10_id);
CREATE INDEX any_records_rel_11_id_idx ON public.any_records USING btree (tenant_id, resource, rel_11_id);
CREATE INDEX any_records_rel_12_id_idx ON public.any_records USING btree (tenant_id, resource, rel_12_id);
CREATE INDEX any_records_rel_13_id_idx ON public.any_records USING btree (tenant_id, resource, rel_13_id);
CREATE INDEX any_records_rel_14_id_idx ON public.any_records USING btree (tenant_id, resource, rel_14_id);
CREATE INDEX any_records_rel_15_id_idx ON public.any_records USING btree (tenant_id, resource, rel_15_id);
CREATE INDEX any_records_rel_1_id_idx ON public.any_records USING btree (tenant_id, resource, rel_1_id);
CREATE INDEX any_records_rel_2_id_idx ON public.any_records USING btree (tenant_id, resource, rel_2_id);
CREATE INDEX any_records_rel_3_id_idx ON public.any_records USING btree (tenant_id, resource, rel_3_id);
CREATE INDEX any_records_rel_4_id_idx ON public.any_records USING btree (tenant_id, resource, rel_4_id);
CREATE INDEX any_records_rel_5_id_idx ON public.any_records USING btree (tenant_id, resource, rel_5_id);
CREATE INDEX any_records_rel_6_id_idx ON public.any_records USING btree (tenant_id, resource, rel_6_id);
CREATE INDEX any_records_rel_7_id_idx ON public.any_records USING btree (tenant_id, resource, rel_7_id);
CREATE INDEX any_records_rel_8_id_idx ON public.any_records USING btree (tenant_id, resource, rel_8_id);
CREATE INDEX any_records_rel_9_id_idx ON public.any_records USING btree (tenant_id, resource, rel_9_id);
CREATE INDEX any_records_resource_index ON public.any_records USING btree (resource);
CREATE INDEX any_records_tenant_id_resource_index ON public.any_records USING btree (tenant_id, resource);

CREATE TABLE public.any_relationship_configs (
    id integer NOT NULL,
    resource_config_id integer NOT NULL,
    relationship_name character varying(255) NOT NULL,
    relationship_type character varying(255) NOT NULL,
    target_resource character varying(255),
    slot_index integer,
    id_column character varying(255),
    type_column character varying(255),
    relationship_key character varying(255),
    through character varying(255),
    foreign_key character varying(255),
    other_key character varying(255),
    alias character varying(255),
    meta_json text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.any_relationship_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.any_relationship_configs_id_seq OWNED BY public.any_relationship_configs.id;
ALTER TABLE ONLY public.any_relationship_configs ALTER COLUMN id SET DEFAULT nextval('public.any_relationship_configs_id_seq'::regclass);
ALTER TABLE ONLY public.any_relationship_configs
    ADD CONSTRAINT any_relationship_configs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.any_relationship_configs
    ADD CONSTRAINT any_relationship_configs_resource_relationship_unique UNIQUE (resource_config_id, relationship_name);
CREATE INDEX any_relationship_configs_resource_config_id_index ON public.any_relationship_configs USING btree (resource_config_id);

CREATE TABLE public.any_resource_configs (
    id integer NOT NULL,
    tenant_id character varying(255) NOT NULL,
    resource character varying(255) NOT NULL,
    schema_json text NOT NULL,
    relationships_json text NOT NULL,
    definition_json text,
    schema_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.any_resource_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.any_resource_configs_id_seq OWNED BY public.any_resource_configs.id;
ALTER TABLE ONLY public.any_resource_configs ALTER COLUMN id SET DEFAULT nextval('public.any_resource_configs_id_seq'::regclass);
ALTER TABLE ONLY public.any_resource_configs
    ADD CONSTRAINT any_resource_configs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.any_resource_configs
    ADD CONSTRAINT any_resource_configs_tenant_id_resource_unique UNIQUE (tenant_id, resource);

CREATE TABLE public.app_fields (
    id character varying(24) NOT NULL,
    table_id character varying(24) NOT NULL,
    workspace_id bigint NOT NULL,
    key character varying(64) NOT NULL,
    label character varying(120) NOT NULL,
    type character varying(16) NOT NULL,
    options jsonb DEFAULT '{}'::jsonb NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    obsolete_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
ALTER TABLE ONLY public.app_fields
    ADD CONSTRAINT app_fields_pkey PRIMARY KEY (id);
CREATE INDEX ix_app_fields_table ON public.app_fields USING btree (table_id);
CREATE UNIQUE INDEX ux_app_fields_key ON public.app_fields USING btree (table_id, key) WHERE (obsolete_at IS NULL);

CREATE TABLE public.app_interest (
    user_id bigint NOT NULL,
    plugin_id character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    id bigint NOT NULL
);
CREATE SEQUENCE public.app_interest_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.app_interest_id_seq OWNED BY public.app_interest.id;
ALTER TABLE ONLY public.app_interest ALTER COLUMN id SET DEFAULT nextval('public.app_interest_id_seq'::regclass);
ALTER TABLE ONLY public.app_interest
    ADD CONSTRAINT app_interest_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX ux_app_interest_key ON public.app_interest USING btree (user_id, plugin_id);

CREATE TABLE public.app_jobs (
    id bigint NOT NULL,
    workspace_id bigint NOT NULL,
    kind character varying(16) NOT NULL,
    bot_id bigint NOT NULL,
    conversation_id bigint,
    user_id bigint,
    watch_id bigint,
    title character varying(200) NOT NULL,
    prompt text NOT NULL,
    status character varying(16) DEFAULT 'queued'::character varying NOT NULL,
    run_after timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    claimed_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    run_id character varying(36),
    attempts smallint DEFAULT '0'::smallint NOT NULL,
    lease_until timestamp with time zone,
    steps jsonb,
    CONSTRAINT app_jobs_kind_check CHECK ((kind IN ('watch', 'handoff', 'shell'))),
    CONSTRAINT app_jobs_status_check CHECK ((status IN ('queued', 'running', 'done', 'failed')))
);
CREATE SEQUENCE public.app_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.app_jobs_id_seq OWNED BY public.app_jobs.id;
ALTER TABLE ONLY public.app_jobs ALTER COLUMN id SET DEFAULT nextval('public.app_jobs_id_seq'::regclass);
ALTER TABLE ONLY public.app_jobs
    ADD CONSTRAINT app_jobs_pkey PRIMARY KEY (id);
CREATE INDEX ix_app_jobs_due ON public.app_jobs USING btree (status, run_after);
CREATE INDEX ix_app_jobs_lease ON public.app_jobs USING btree (lease_until) WHERE (((status)::text = 'running'::text) AND (lease_until IS NOT NULL));

CREATE TABLE public.app_pins (
    workspace_id bigint NOT NULL,
    user_id bigint NOT NULL,
    app_id character varying(24) NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    id bigint NOT NULL
);
CREATE SEQUENCE public.app_pins_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.app_pins_id_seq OWNED BY public.app_pins.id;
ALTER TABLE ONLY public.app_pins ALTER COLUMN id SET DEFAULT nextval('public.app_pins_id_seq'::regclass);
ALTER TABLE ONLY public.app_pins
    ADD CONSTRAINT app_pins_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX ux_app_pins_key ON public.app_pins USING btree (workspace_id, user_id, app_id);

CREATE TABLE public.app_practices (
    id character varying(24) NOT NULL,
    workspace_id bigint NOT NULL,
    app_id character varying(24) NOT NULL,
    version_id bigint NOT NULL,
    copied jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    used_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
ALTER TABLE ONLY public.app_practices
    ADD CONSTRAINT app_practices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.app_practices
    ADD CONSTRAINT ux_app_practices_version UNIQUE (version_id);
CREATE INDEX ix_app_practices_used ON public.app_practices USING btree (used_at);
CREATE INDEX ix_app_practices_workspace ON public.app_practices USING btree (workspace_id);

CREATE TABLE public.app_script_rounds (
    id bigint NOT NULL,
    workspace_id bigint NOT NULL,
    app_id character varying(24) NOT NULL,
    script_key character varying(64) NOT NULL,
    round integer NOT NULL,
    passed integer NOT NULL,
    failed integer NOT NULL,
    failures jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.app_script_rounds_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.app_script_rounds_id_seq OWNED BY public.app_script_rounds.id;
ALTER TABLE ONLY public.app_script_rounds ALTER COLUMN id SET DEFAULT nextval('public.app_script_rounds_id_seq'::regclass);
ALTER TABLE ONLY public.app_script_rounds
    ADD CONSTRAINT app_script_rounds_pkey PRIMARY KEY (id);
CREATE INDEX ix_app_script_rounds_script ON public.app_script_rounds USING btree (app_id, script_key, id);

CREATE TABLE public.app_script_runs (
    id bigint NOT NULL,
    workspace_id bigint NOT NULL,
    script_id character varying(24) NOT NULL,
    started_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ms integer DEFAULT 0 NOT NULL,
    calls integer DEFAULT 0 NOT NULL,
    ok boolean NOT NULL,
    error text,
    via jsonb DEFAULT '{}'::jsonb NOT NULL,
    log text
);
CREATE SEQUENCE public.app_script_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.app_script_runs_id_seq OWNED BY public.app_script_runs.id;
ALTER TABLE ONLY public.app_script_runs ALTER COLUMN id SET DEFAULT nextval('public.app_script_runs_id_seq'::regclass);
ALTER TABLE ONLY public.app_script_runs
    ADD CONSTRAINT app_script_runs_pkey PRIMARY KEY (id);
CREATE INDEX ix_app_script_runs_script ON public.app_script_runs USING btree (script_id, id);

CREATE TABLE public.app_scripts (
    id character varying(24) NOT NULL,
    workspace_id bigint NOT NULL,
    app_id character varying(24) NOT NULL,
    key character varying(64) NOT NULL,
    summary text NOT NULL,
    code text NOT NULL,
    tests jsonb DEFAULT '[]'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    kind character varying(16) DEFAULT 'action'::character varying NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    next_run_at timestamp with time zone,
    cursor xid8,
    CONSTRAINT app_scripts_kind_check CHECK ((kind IN ('action', 'source', 'rule', 'function', 'job')))
);
ALTER TABLE ONLY public.app_scripts
    ADD CONSTRAINT app_scripts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.app_scripts
    ADD CONSTRAINT ux_app_scripts_key UNIQUE (app_id, key);
CREATE INDEX ix_app_scripts_due ON public.app_scripts USING btree (next_run_at) WHERE (next_run_at IS NOT NULL);
CREATE INDEX ix_app_scripts_kind ON public.app_scripts USING btree (kind, workspace_id);

CREATE TABLE public.app_settings (
    workspace_id bigint NOT NULL,
    builder_bot_id bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    id bigint NOT NULL
);
CREATE SEQUENCE public.app_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.app_settings_id_seq OWNED BY public.app_settings.id;
ALTER TABLE ONLY public.app_settings ALTER COLUMN id SET DEFAULT nextval('public.app_settings_id_seq'::regclass);
ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX ux_app_settings_key ON public.app_settings USING btree (workspace_id);

CREATE TABLE public.app_tables (
    id character varying(24) NOT NULL,
    workspace_id bigint NOT NULL,
    key character varying(64) NOT NULL,
    label character varying(120) NOT NULL,
    title_field_id character varying(24),
    obsolete_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    writers character varying(16) DEFAULT 'home'::character varying NOT NULL,
    CONSTRAINT app_tables_writers_check CHECK ((writers IN ('home', 'editors')))
);
ALTER TABLE ONLY public.app_tables
    ADD CONSTRAINT app_tables_pkey PRIMARY KEY (id);
CREATE INDEX ix_app_tables_workspace ON public.app_tables USING btree (workspace_id);
CREATE UNIQUE INDEX ux_app_tables_key ON public.app_tables USING btree (workspace_id, key) WHERE (obsolete_at IS NULL);

CREATE TABLE public.app_themes (
    workspace_id bigint NOT NULL,
    theme jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    id bigint NOT NULL
);
CREATE SEQUENCE public.app_themes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.app_themes_id_seq OWNED BY public.app_themes.id;
ALTER TABLE ONLY public.app_themes ALTER COLUMN id SET DEFAULT nextval('public.app_themes_id_seq'::regclass);
ALTER TABLE ONLY public.app_themes
    ADD CONSTRAINT app_themes_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX ux_app_themes_key ON public.app_themes USING btree (workspace_id);

CREATE TABLE public.app_versions (
    id bigint NOT NULL,
    app_id character varying(24) NOT NULL,
    workspace_id bigint NOT NULL,
    number integer,
    definition jsonb NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    kind character varying(16) DEFAULT 'builder'::character varying NOT NULL,
    created_by jsonb DEFAULT '{}'::jsonb NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.app_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.app_versions_id_seq OWNED BY public.app_versions.id;
ALTER TABLE ONLY public.app_versions ALTER COLUMN id SET DEFAULT nextval('public.app_versions_id_seq'::regclass);
ALTER TABLE ONLY public.app_versions
    ADD CONSTRAINT app_versions_pkey PRIMARY KEY (id);
CREATE INDEX ix_app_versions_app ON public.app_versions USING btree (app_id, id);

CREATE TABLE public.app_watches (
    id bigint NOT NULL,
    workspace_id bigint NOT NULL,
    bot_id bigint NOT NULL,
    conversation_id bigint NOT NULL,
    created_by bigint,
    name character varying(120) NOT NULL,
    table_id character varying(24) NOT NULL,
    "on" character varying(16) NOT NULL,
    condition text,
    instructions text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    cursor xid8 NOT NULL,
    runs_hour_start timestamp with time zone,
    runs_in_hour integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT app_watches_on_check CHECK (("on" IN ('create', 'update', 'any')))
);
CREATE SEQUENCE public.app_watches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.app_watches_id_seq OWNED BY public.app_watches.id;
ALTER TABLE ONLY public.app_watches ALTER COLUMN id SET DEFAULT nextval('public.app_watches_id_seq'::regclass);
ALTER TABLE ONLY public.app_watches
    ADD CONSTRAINT app_watches_pkey PRIMARY KEY (id);
CREATE INDEX ix_app_watches_enabled ON public.app_watches USING btree (enabled, workspace_id);

CREATE TABLE public.app_web_access (
    id bigint NOT NULL,
    workspace_id bigint NOT NULL,
    origin character varying(255) NOT NULL,
    headers jsonb,
    created_by jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.app_web_access_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.app_web_access_id_seq OWNED BY public.app_web_access.id;
ALTER TABLE ONLY public.app_web_access ALTER COLUMN id SET DEFAULT nextval('public.app_web_access_id_seq'::regclass);
ALTER TABLE ONLY public.app_web_access
    ADD CONSTRAINT app_web_access_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.app_web_access
    ADD CONSTRAINT ux_app_web_access_origin UNIQUE (workspace_id, origin);

CREATE TABLE public.approval_rules (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    action character varying(200) NOT NULL,
    behaviour character varying(8) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    workspace_id bigint
);
CREATE SEQUENCE public.approval_rules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.approval_rules_id_seq OWNED BY public.approval_rules.id;
ALTER TABLE ONLY public.approval_rules ALTER COLUMN id SET DEFAULT nextval('public.approval_rules_id_seq'::regclass);
ALTER TABLE ONLY public.approval_rules
    ADD CONSTRAINT approval_rules_pkey PRIMARY KEY (id);
CREATE INDEX approval_rules_workspace_id_index ON public.approval_rules USING btree (workspace_id);
CREATE INDEX ix_approval_rules_user ON public.approval_rules USING btree (user_id);

CREATE TABLE public.apps (
    id character varying(24) NOT NULL,
    workspace_id bigint NOT NULL,
    slug character varying(64) NOT NULL,
    name character varying(80) NOT NULL,
    icon character varying(40) DEFAULT 'apps'::character varying NOT NULL,
    color character varying(16) DEFAULT '#1f1f1f'::character varying NOT NULL,
    visibility character varying(16) DEFAULT 'internal'::character varying NOT NULL,
    live_version_id bigint,
    draft_version_id bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    public_at timestamp with time zone,
    access character varying(16) DEFAULT 'home'::character varying NOT NULL,
    theme jsonb,
    kind character varying(8) DEFAULT 'app'::character varying NOT NULL,
    made_by_user_id bigint,
    made_by_bot_id bigint,
    retired_at timestamp with time zone,
    CONSTRAINT apps_access_check CHECK ((access IN ('home', 'members'))),
    CONSTRAINT apps_kind_check CHECK ((kind IN ('app', 'view')))
);
ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.apps
    ADD CONSTRAINT ux_apps_slug UNIQUE (workspace_id, slug);

CREATE TABLE public.audit_events (
    id bigint NOT NULL,
    workspace_id bigint NOT NULL,
    at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    actor jsonb NOT NULL,
    via jsonb DEFAULT '{}'::jsonb NOT NULL,
    table_id character varying(24),
    record_id character varying(64),
    action character varying(16) NOT NULL,
    changes jsonb DEFAULT '{}'::jsonb NOT NULL,
    xid xid8 DEFAULT pg_current_xact_id() NOT NULL
);
CREATE SEQUENCE public.audit_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.audit_events_id_seq OWNED BY public.audit_events.id;
ALTER TABLE ONLY public.audit_events ALTER COLUMN id SET DEFAULT nextval('public.audit_events_id_seq'::regclass);
ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);
CREATE INDEX ix_audit_events_actor ON public.audit_events USING btree (workspace_id, ((actor ->> 'id'::text)), id DESC);
CREATE INDEX ix_audit_events_app ON public.audit_events USING btree (workspace_id, ((via ->> 'appId'::text)), id DESC);
CREATE INDEX ix_audit_events_record ON public.audit_events USING btree (workspace_id, table_id, record_id, id DESC);
CREATE INDEX ix_audit_events_watch ON public.audit_events USING btree (workspace_id, table_id, xid);
CREATE INDEX ix_audit_events_workspace_at ON public.audit_events USING btree (workspace_id, at DESC, id DESC);

CREATE TABLE public.bot_browser_state (
    profile_saved_at timestamp with time zone,
    cookies_saved_at timestamp with time zone,
    url text DEFAULT ''::text NOT NULL,
    conversation_id bigint NOT NULL,
    profile_file character varying(80),
    profile_sha256 character varying(64),
    profile_bytes bigint,
    cookies_sha256 character varying(64),
    workspace_id bigint NOT NULL
);
ALTER TABLE ONLY public.bot_browser_state
    ADD CONSTRAINT bot_browser_state_pkey PRIMARY KEY (conversation_id);
CREATE INDEX bot_browser_state_workspace_id_index ON public.bot_browser_state USING btree (workspace_id);

CREATE TABLE public.bot_computers (
    server_id character varying(200) NOT NULL,
    state character varying(20) DEFAULT 'asleep'::character varying NOT NULL,
    url text DEFAULT ''::text NOT NULL,
    error text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    conversation_id bigint NOT NULL,
    workspace_id bigint NOT NULL
);
ALTER TABLE ONLY public.bot_computers
    ADD CONSTRAINT bot_computers_pkey PRIMARY KEY (conversation_id);
CREATE INDEX bot_computers_workspace_id_index ON public.bot_computers USING btree (workspace_id);

CREATE TABLE public.bot_conversations (
    id bigint NOT NULL,
    workspace_id bigint NOT NULL,
    bot_id bigint NOT NULL,
    user_id bigint,
    onboarding_step character varying(32),
    waiting_task character varying(200),
    unread boolean DEFAULT false NOT NULL,
    read_up_to bigint,
    pin_position integer,
    section_id bigint,
    hidden boolean DEFAULT false NOT NULL,
    last_activity_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    title character varying(40),
    parent_id bigint,
    forked_at_message_id bigint,
    created_by bigint,
    room_id bigint,
    keep_out_of_notebook boolean DEFAULT false NOT NULL,
    app_id character varying(24),
    group_id bigint,
    job_notes jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT bot_conversations_room_title CHECK (((user_id IS NOT NULL) OR (title IS NOT NULL)))
);
CREATE SEQUENCE public.bot_conversations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bot_conversations_id_seq OWNED BY public.bot_conversations.id;
ALTER TABLE ONLY public.bot_conversations ALTER COLUMN id SET DEFAULT nextval('public.bot_conversations_id_seq'::regclass);
ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_bot_id_user_id_unique UNIQUE (bot_id, user_id);
ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_pkey PRIMARY KEY (id);
CREATE INDEX bot_conversations_workspace_id_user_id_index ON public.bot_conversations USING btree (workspace_id, user_id);
CREATE UNIQUE INDEX ux_bot_conversations_app_room ON public.bot_conversations USING btree (bot_id, app_id);
CREATE UNIQUE INDEX ux_bot_conversations_group_seat ON public.bot_conversations USING btree (bot_id, group_id);

CREATE TABLE public.bot_group_members (
    group_id bigint NOT NULL,
    bot_id bigint NOT NULL,
    "position" integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    workspace_id bigint NOT NULL,
    id bigint NOT NULL
);
CREATE SEQUENCE public.bot_group_members_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bot_group_members_id_seq OWNED BY public.bot_group_members.id;
ALTER TABLE ONLY public.bot_group_members ALTER COLUMN id SET DEFAULT nextval('public.bot_group_members_id_seq'::regclass);
ALTER TABLE ONLY public.bot_group_members
    ADD CONSTRAINT bot_group_members_pkey PRIMARY KEY (id);
CREATE INDEX bot_group_members_workspace_id_index ON public.bot_group_members USING btree (workspace_id);
CREATE INDEX ix_bot_group_members_bot ON public.bot_group_members USING btree (bot_id);
CREATE UNIQUE INDEX ux_bot_group_members_key ON public.bot_group_members USING btree (group_id, bot_id);

CREATE TABLE public.bot_group_people (
    group_id bigint NOT NULL,
    user_id bigint NOT NULL,
    added_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    workspace_id bigint NOT NULL,
    id bigint NOT NULL
);
CREATE SEQUENCE public.bot_group_people_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bot_group_people_id_seq OWNED BY public.bot_group_people.id;
ALTER TABLE ONLY public.bot_group_people ALTER COLUMN id SET DEFAULT nextval('public.bot_group_people_id_seq'::regclass);
ALTER TABLE ONLY public.bot_group_people
    ADD CONSTRAINT bot_group_people_pkey PRIMARY KEY (id);
CREATE INDEX bot_group_people_workspace_id_index ON public.bot_group_people USING btree (workspace_id);
CREATE INDEX ix_bot_group_people_user ON public.bot_group_people USING btree (user_id);
CREATE UNIQUE INDEX ux_bot_group_people_key ON public.bot_group_people USING btree (group_id, user_id);

CREATE TABLE public.bot_messages (
    id bigint NOT NULL,
    bot_id bigint NOT NULL,
    kind character varying(16) NOT NULL,
    role character varying(16) NOT NULL,
    body jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    conversation_id bigint NOT NULL,
    changed xid8 DEFAULT pg_current_xact_id() NOT NULL,
    workspace_id bigint NOT NULL
);
CREATE SEQUENCE public.bot_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bot_messages_id_seq OWNED BY public.bot_messages.id;
ALTER TABLE ONLY public.bot_messages ALTER COLUMN id SET DEFAULT nextval('public.bot_messages_id_seq'::regclass);
ALTER TABLE ONLY public.bot_messages
    ADD CONSTRAINT bot_messages_pkey PRIMARY KEY (id);
CREATE INDEX bot_messages_conversation_id_id_index ON public.bot_messages USING btree (conversation_id, id);
CREATE INDEX bot_messages_workspace_id_index ON public.bot_messages USING btree (workspace_id);
CREATE INDEX ix_bot_messages_bot ON public.bot_messages USING btree (bot_id, id);
CREATE INDEX ix_bot_messages_changed ON public.bot_messages USING btree (conversation_id, changed);
CREATE INDEX ix_bot_messages_connecting ON public.bot_messages USING btree (((body ->> 'connectingAt'::text)) COLLATE "C") WHERE (((kind)::text = 'connect'::text) AND ((body ->> 'status'::text) = 'connecting'::text));
CREATE INDEX ix_bot_messages_note ON public.bot_messages USING btree (((body ->> 'noteId'::text))) WHERE ((kind)::text = 'note'::text);

CREATE TABLE public.bot_notebook (
    id bigint NOT NULL,
    workspace_id bigint NOT NULL,
    bot_id bigint NOT NULL,
    text character varying(500) NOT NULL,
    source_user_id bigint,
    source_conversation_id bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    removed_at timestamp with time zone
);
CREATE SEQUENCE public.bot_notebook_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bot_notebook_id_seq OWNED BY public.bot_notebook.id;
ALTER TABLE ONLY public.bot_notebook ALTER COLUMN id SET DEFAULT nextval('public.bot_notebook_id_seq'::regclass);
ALTER TABLE ONLY public.bot_notebook
    ADD CONSTRAINT bot_notebook_pkey PRIMARY KEY (id);
CREATE INDEX bot_notebook_bot_id_removed_at_index ON public.bot_notebook USING btree (bot_id, removed_at);

CREATE TABLE public.bot_policies (
    user_id bigint NOT NULL,
    auto_review boolean DEFAULT true NOT NULL,
    workspace_id bigint,
    id bigint NOT NULL
);
CREATE SEQUENCE public.bot_policies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bot_policies_id_seq OWNED BY public.bot_policies.id;
ALTER TABLE ONLY public.bot_policies ALTER COLUMN id SET DEFAULT nextval('public.bot_policies_id_seq'::regclass);
ALTER TABLE ONLY public.bot_policies
    ADD CONSTRAINT bot_policies_pkey PRIMARY KEY (id);
CREATE INDEX bot_policies_workspace_id_index ON public.bot_policies USING btree (workspace_id);
CREATE UNIQUE INDEX ux_bot_policies_key ON public.bot_policies USING btree (user_id);

CREATE TABLE public.bot_requests (
    id bigint NOT NULL,
    workspace_id bigint NOT NULL,
    user_id bigint NOT NULL,
    kind character varying(8) DEFAULT 'ask'::character varying NOT NULL,
    from_bot_id bigint NOT NULL,
    from_conversation_id bigint NOT NULL,
    to_bot_id bigint NOT NULL,
    to_conversation_id bigint NOT NULL,
    parent_id bigint,
    depth integer DEFAULT 0 NOT NULL,
    chain jsonb DEFAULT '[]'::jsonb NOT NULL,
    brief text NOT NULL,
    answer text,
    question text,
    reply text,
    questions integer DEFAULT 0 NOT NULL,
    turns integer DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'queued'::character varying NOT NULL,
    next_step character varying(12),
    run_after timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    lease_until timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    time_zone character varying(64) DEFAULT 'UTC'::character varying NOT NULL,
    language character varying(40) DEFAULT ''::character varying NOT NULL,
    from_message_id bigint,
    to_message_id bigint,
    deadline_at timestamp with time zone DEFAULT (now() + '00:30:00'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT bot_requests_status CHECK ((status IN ('queued', 'working', 'question', 'waiting_approval', 'done', 'failed', 'cancelled'))),
    CONSTRAINT bot_requests_step CHECK (((next_step IS NULL) OR (next_step IN ('target_turn', 'asker_turn'))))
);
CREATE SEQUENCE public.bot_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bot_requests_id_seq OWNED BY public.bot_requests.id;
ALTER TABLE ONLY public.bot_requests ALTER COLUMN id SET DEFAULT nextval('public.bot_requests_id_seq'::regclass);
ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT bot_requests_pkey PRIMARY KEY (id);
CREATE INDEX bot_requests_from_conversation_id_status_index ON public.bot_requests USING btree (from_conversation_id, status);
CREATE INDEX bot_requests_to_conversation_id_status_index ON public.bot_requests USING btree (to_conversation_id, status);
CREATE INDEX ix_bot_requests_due ON public.bot_requests USING btree (run_after) WHERE (next_step IS NOT NULL);
CREATE UNIQUE INDEX ux_bot_requests_open ON public.bot_requests USING btree (from_bot_id, to_bot_id, user_id) WHERE (status IN ('queued', 'working', 'question', 'waiting_approval'));

CREATE TABLE public.bot_routines (
    id bigint NOT NULL,
    bot_id bigint NOT NULL,
    name character varying(120) NOT NULL,
    schedule character varying(120) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    instructions text DEFAULT ''::text NOT NULL,
    cron character varying(120),
    timezone character varying(64) DEFAULT 'UTC'::character varying NOT NULL,
    next_run_at timestamp with time zone,
    last_run_at timestamp with time zone,
    once boolean DEFAULT false NOT NULL,
    conversation_id bigint NOT NULL,
    workspace_id bigint NOT NULL,
    failures smallint DEFAULT '0'::smallint NOT NULL,
    run_id character varying(36),
    run_attempts smallint DEFAULT '0'::smallint NOT NULL,
    run_lease_until timestamp with time zone,
    run_steps jsonb
);
CREATE SEQUENCE public.bot_routines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bot_routines_id_seq OWNED BY public.bot_routines.id;
ALTER TABLE ONLY public.bot_routines ALTER COLUMN id SET DEFAULT nextval('public.bot_routines_id_seq'::regclass);
ALTER TABLE ONLY public.bot_routines
    ADD CONSTRAINT bot_routines_pkey PRIMARY KEY (id);
CREATE INDEX bot_routines_conversation_id_index ON public.bot_routines USING btree (conversation_id);
CREATE INDEX bot_routines_workspace_id_index ON public.bot_routines USING btree (workspace_id);
CREATE INDEX ix_bot_routines_bot ON public.bot_routines USING btree (bot_id);
CREATE INDEX ix_bot_routines_due ON public.bot_routines USING btree (enabled, next_run_at);
CREATE INDEX ix_bot_routines_run_lease ON public.bot_routines USING btree (run_lease_until) WHERE (run_id IS NOT NULL);

CREATE TABLE public.bot_sections (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    name character varying(80) NOT NULL,
    "position" integer NOT NULL,
    collapsed boolean DEFAULT false NOT NULL,
    workspace_id bigint NOT NULL
);
CREATE SEQUENCE public.bot_sections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bot_sections_id_seq OWNED BY public.bot_sections.id;
ALTER TABLE ONLY public.bot_sections ALTER COLUMN id SET DEFAULT nextval('public.bot_sections_id_seq'::regclass);
ALTER TABLE ONLY public.bot_sections
    ADD CONSTRAINT bot_sections_pkey PRIMARY KEY (id);
CREATE INDEX bot_sections_workspace_id_index ON public.bot_sections USING btree (workspace_id);
CREATE INDEX ix_bot_sections_user ON public.bot_sections USING btree (user_id);

CREATE TABLE public.bots (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    name character varying(80) NOT NULL,
    color character varying(16) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_main boolean DEFAULT false NOT NULL,
    label character varying(60),
    shape character varying(24) DEFAULT 'cloud'::character varying NOT NULL,
    kind character varying(10) DEFAULT 'bot'::character varying NOT NULL,
    workspace_id bigint NOT NULL,
    sharing character varying(16) DEFAULT 'mixed'::character varying NOT NULL,
    instructions text,
    skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    origin jsonb,
    CONSTRAINT bots_sharing_check CHECK ((sharing IN ('private', 'shared', 'mixed')))
);
CREATE SEQUENCE public.bots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bots_id_seq OWNED BY public.bots.id;
ALTER TABLE ONLY public.bots ALTER COLUMN id SET DEFAULT nextval('public.bots_id_seq'::regclass);
ALTER TABLE ONLY public.bots
    ADD CONSTRAINT bots_pkey PRIMARY KEY (id);
CREATE INDEX bots_workspace_id_index ON public.bots USING btree (workspace_id);
CREATE INDEX ix_bots_user ON public.bots USING btree (user_id);

CREATE TABLE public.bridge_link (
    id bigint NOT NULL,
    hub_url character varying(300) NOT NULL,
    name character varying(80) NOT NULL,
    linked_by bigint,
    token jsonb,
    pending jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.bridge_link_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bridge_link_id_seq OWNED BY public.bridge_link.id;
ALTER TABLE ONLY public.bridge_link ALTER COLUMN id SET DEFAULT nextval('public.bridge_link_id_seq'::regclass);
ALTER TABLE ONLY public.bridge_link
    ADD CONSTRAINT bridge_link_pkey PRIMARY KEY (id);

CREATE TABLE public.computer_days (
    workspace_id bigint DEFAULT 0 NOT NULL,
    computer_id bigint NOT NULL,
    id bigint NOT NULL,
    day date NOT NULL
);
CREATE SEQUENCE public.computer_days_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.computer_days_id_seq OWNED BY public.computer_days.id;
ALTER TABLE ONLY public.computer_days ALTER COLUMN id SET DEFAULT nextval('public.computer_days_id_seq'::regclass);
ALTER TABLE ONLY public.computer_days
    ADD CONSTRAINT computer_days_pkey PRIMARY KEY (workspace_id, computer_id);
CREATE INDEX ix_computer_days_id ON public.computer_days USING btree (id);

CREATE TABLE public.computer_tickets (
    ticket character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    conversation_id bigint NOT NULL,
    workspace_id bigint NOT NULL
);
ALTER TABLE ONLY public.computer_tickets
    ADD CONSTRAINT computer_tickets_pkey PRIMARY KEY (ticket);
CREATE INDEX computer_tickets_workspace_id_index ON public.computer_tickets USING btree (workspace_id);

CREATE TABLE public.connect_follow_ups (
    id bigint NOT NULL,
    workspace_id bigint NOT NULL,
    message_id bigint NOT NULL,
    conversation_id bigint NOT NULL,
    user_id bigint NOT NULL,
    personal boolean NOT NULL,
    plugin_id character varying(64) NOT NULL,
    status character varying(8) DEFAULT 'waiting'::character varying NOT NULL,
    waiting_since timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    run_id character varying(36),
    attempts smallint DEFAULT '0'::smallint NOT NULL,
    lease_until timestamp with time zone,
    steps jsonb,
    CONSTRAINT connect_follow_ups_status CHECK ((status IN ('waiting', 'ready')))
);
CREATE SEQUENCE public.connect_follow_ups_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.connect_follow_ups_id_seq OWNED BY public.connect_follow_ups.id;
ALTER TABLE ONLY public.connect_follow_ups ALTER COLUMN id SET DEFAULT nextval('public.connect_follow_ups_id_seq'::regclass);
ALTER TABLE ONLY public.connect_follow_ups
    ADD CONSTRAINT connect_follow_ups_message_id_unique UNIQUE (message_id);
ALTER TABLE ONLY public.connect_follow_ups
    ADD CONSTRAINT connect_follow_ups_pkey PRIMARY KEY (id);
CREATE INDEX ix_connect_follow_ups_chat ON public.connect_follow_ups USING btree (conversation_id) WHERE ((status)::text = 'ready'::text);
CREATE INDEX ix_connect_follow_ups_due ON public.connect_follow_ups USING btree (lease_until) WHERE ((status)::text = 'ready'::text);
CREATE INDEX ix_connect_follow_ups_expiring ON public.connect_follow_ups USING btree (waiting_since) WHERE ((status)::text = 'waiting'::text);
CREATE INDEX ix_connect_follow_ups_home ON public.connect_follow_ups USING btree (workspace_id, plugin_id) WHERE ((status)::text = 'waiting'::text);
CREATE INDEX ix_connect_follow_ups_person ON public.connect_follow_ups USING btree (user_id, plugin_id) WHERE ((status)::text = 'waiting'::text);

CREATE TABLE public.connector_apps (
    id bigint NOT NULL,
    plugin_id character varying(64) NOT NULL,
    redirect_uri character varying(300) NOT NULL,
    server jsonb NOT NULL,
    client jsonb NOT NULL,
    tools jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.connector_apps_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.connector_apps_id_seq OWNED BY public.connector_apps.id;
ALTER TABLE ONLY public.connector_apps ALTER COLUMN id SET DEFAULT nextval('public.connector_apps_id_seq'::regclass);
ALTER TABLE ONLY public.connector_apps
    ADD CONSTRAINT connector_apps_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.connector_apps
    ADD CONSTRAINT connector_apps_plugin_id_unique UNIQUE (plugin_id);

CREATE TABLE public.conversation_reads (
    conversation_id bigint NOT NULL,
    user_id bigint NOT NULL,
    read_up_to bigint NOT NULL,
    id bigint NOT NULL
);
CREATE SEQUENCE public.conversation_reads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.conversation_reads_id_seq OWNED BY public.conversation_reads.id;
ALTER TABLE ONLY public.conversation_reads ALTER COLUMN id SET DEFAULT nextval('public.conversation_reads_id_seq'::regclass);
ALTER TABLE ONLY public.conversation_reads
    ADD CONSTRAINT conversation_reads_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX ux_conversation_reads_key ON public.conversation_reads USING btree (conversation_id, user_id);

CREATE TABLE public.file_storage (
    workspace_id bigint NOT NULL,
    kind text NOT NULL,
    settings jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    id bigint NOT NULL,
    drive_look jsonb,
    move jsonb,
    move_status text,
    move_claim text,
    move_lease_until timestamp with time zone,
    move_cancel boolean DEFAULT false NOT NULL
);
CREATE SEQUENCE public.file_storage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.file_storage_id_seq OWNED BY public.file_storage.id;
ALTER TABLE ONLY public.file_storage ALTER COLUMN id SET DEFAULT nextval('public.file_storage_id_seq'::regclass);
ALTER TABLE ONLY public.file_storage
    ADD CONSTRAINT file_storage_pkey PRIMARY KEY (id);
CREATE INDEX file_storage_moves_going ON public.file_storage USING btree (move_lease_until) WHERE (move_status = ANY (ARRAY['running'::text, 'switched'::text]));
CREATE UNIQUE INDEX ux_file_storage_key ON public.file_storage USING btree (workspace_id);

CREATE TABLE public.mercbot_servers (
    id character varying(200) NOT NULL,
    url character varying(500) NOT NULL,
    seen_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
ALTER TABLE ONLY public.mercbot_servers
    ADD CONSTRAINT mercbot_servers_pkey PRIMARY KEY (id);

CREATE TABLE public.mercbot_settings (
    name character varying(60) NOT NULL,
    value text NOT NULL
);
ALTER TABLE ONLY public.mercbot_settings
    ADD CONSTRAINT mercbot_settings_pkey PRIMARY KEY (name);

CREATE TABLE public.oauth_states (
    state character varying(64) NOT NULL,
    provider character varying(32) NOT NULL,
    account_id bigint,
    bridge_connection_id bigint,
    verifier jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_pkey PRIMARY KEY (state);

CREATE TABLE public.page_versions (
    id bigint NOT NULL,
    workspace_id bigint NOT NULL,
    bot_id bigint NOT NULL,
    path text NOT NULL,
    page_key character varying(40) NOT NULL,
    kind character varying(12) NOT NULL,
    user_id bigint,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT page_versions_kind_check CHECK ((kind IN ('save', 'edit', 'restore')))
);
CREATE SEQUENCE public.page_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.page_versions_id_seq OWNED BY public.page_versions.id;
ALTER TABLE ONLY public.page_versions ALTER COLUMN id SET DEFAULT nextval('public.page_versions_id_seq'::regclass);
ALTER TABLE ONLY public.page_versions
    ADD CONSTRAINT page_versions_pkey PRIMARY KEY (id);
CREATE INDEX ix_page_versions_page ON public.page_versions USING btree (workspace_id, bot_id, path, id);

CREATE TABLE public.person_memories (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    fact text NOT NULL,
    bot_id bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    workspace_id bigint NOT NULL
);
CREATE SEQUENCE public.person_memories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.person_memories_id_seq OWNED BY public.person_memories.id;
ALTER TABLE ONLY public.person_memories ALTER COLUMN id SET DEFAULT nextval('public.person_memories_id_seq'::regclass);
ALTER TABLE ONLY public.person_memories
    ADD CONSTRAINT person_memories_pkey PRIMARY KEY (id);
CREATE INDEX ix_person_memories_user ON public.person_memories USING btree (user_id);
CREATE INDEX person_memories_workspace_id_index ON public.person_memories USING btree (workspace_id);

CREATE TABLE public.plugin_accounts (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    plugin_id character varying(64) NOT NULL,
    name character varying(80) NOT NULL,
    status character varying(16) DEFAULT 'needs-auth'::character varying NOT NULL,
    tokens jsonb,
    bridge_ref character varying(64),
    label character varying(200),
    connected_at timestamp with time zone,
    workspace_id bigint,
    sign_in_state character varying(16)
);
CREATE SEQUENCE public.plugin_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.plugin_accounts_id_seq OWNED BY public.plugin_accounts.id;
ALTER TABLE ONLY public.plugin_accounts ALTER COLUMN id SET DEFAULT nextval('public.plugin_accounts_id_seq'::regclass);
ALTER TABLE ONLY public.plugin_accounts
    ADD CONSTRAINT plugin_accounts_bridge_ref_unique UNIQUE (bridge_ref);
ALTER TABLE ONLY public.plugin_accounts
    ADD CONSTRAINT plugin_accounts_pkey PRIMARY KEY (id);
CREATE INDEX ix_plugin_accounts_user ON public.plugin_accounts USING btree (user_id, plugin_id);
CREATE INDEX plugin_accounts_workspace_id_index ON public.plugin_accounts USING btree (workspace_id);

CREATE TABLE public.plugin_actions_off (
    user_id bigint NOT NULL,
    plugin_id character varying(80) NOT NULL,
    action_id character varying(80) NOT NULL,
    id bigint NOT NULL
);
CREATE SEQUENCE public.plugin_actions_off_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.plugin_actions_off_id_seq OWNED BY public.plugin_actions_off.id;
ALTER TABLE ONLY public.plugin_actions_off ALTER COLUMN id SET DEFAULT nextval('public.plugin_actions_off_id_seq'::regclass);
ALTER TABLE ONLY public.plugin_actions_off
    ADD CONSTRAINT plugin_actions_off_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX ux_plugin_actions_off_key ON public.plugin_actions_off USING btree (user_id, plugin_id, action_id);

CREATE TABLE public.shell_runs (
    id bigint NOT NULL,
    workspace_id bigint NOT NULL,
    bot_id bigint NOT NULL,
    conversation_id bigint,
    user_id bigint,
    why text DEFAULT ''::text NOT NULL,
    script text NOT NULL,
    status character varying(12) DEFAULT 'running'::character varying NOT NULL,
    background boolean DEFAULT false NOT NULL,
    server character varying(64) NOT NULL,
    exit_code integer,
    output text DEFAULT ''::text NOT NULL,
    changed jsonb DEFAULT '[]'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    heartbeat_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT shell_runs_status_check CHECK ((status IN ('running', 'done', 'failed', 'stopped')))
);
CREATE SEQUENCE public.shell_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.shell_runs_id_seq OWNED BY public.shell_runs.id;
ALTER TABLE ONLY public.shell_runs ALTER COLUMN id SET DEFAULT nextval('public.shell_runs_id_seq'::regclass);
ALTER TABLE ONLY public.shell_runs
    ADD CONSTRAINT shell_runs_pkey PRIMARY KEY (id);
CREATE INDEX ix_shell_runs_conversation ON public.shell_runs USING btree (conversation_id, id);
CREATE INDEX ix_shell_runs_status ON public.shell_runs USING btree (status, heartbeat_at);

CREATE TABLE public.usage_daily (
    workspace_id bigint DEFAULT 0 NOT NULL,
    day date NOT NULL,
    bot_id bigint DEFAULT 0 NOT NULL,
    user_id bigint DEFAULT 0 NOT NULL,
    kind character varying(20) NOT NULL,
    id bigint NOT NULL,
    bot_name character varying(80),
    calls integer DEFAULT 0 NOT NULL,
    estimated_calls integer DEFAULT 0 NOT NULL,
    cache_hit_tokens bigint DEFAULT 0 NOT NULL,
    cache_miss_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    images integer DEFAULT 0 NOT NULL,
    seconds bigint DEFAULT 0 NOT NULL,
    cost_nano bigint DEFAULT 0 NOT NULL
)
PARTITION BY RANGE (day);
CREATE SEQUENCE public.usage_daily_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.usage_daily_id_seq OWNED BY public.usage_daily.id;
ALTER TABLE public.usage_daily ALTER COLUMN id SET DEFAULT nextval('public.usage_daily_id_seq'::regclass);
CREATE INDEX ix_usage_daily_id ON public.usage_daily USING btree (id);
CREATE UNIQUE INDEX ux_usage_daily_key ON public.usage_daily USING btree (workspace_id, day, bot_id, user_id, kind);

CREATE TABLE public.usage_events (
    workspace_id bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone CONSTRAINT usage_events_created_at_not_null1 NOT NULL,
    id bigint CONSTRAINT usage_events_id_not_null1 NOT NULL,
    user_id bigint,
    bot_id bigint,
    bot_name character varying(80),
    kind character varying(20) CONSTRAINT usage_events_kind_not_null1 NOT NULL,
    purpose character varying(20) DEFAULT ''::character varying NOT NULL,
    state character varying(12) DEFAULT 'done'::character varying NOT NULL,
    served_by character varying(40),
    cache_hit_tokens integer DEFAULT 0 CONSTRAINT usage_events_cache_hit_tokens_not_null1 NOT NULL,
    cache_miss_tokens integer DEFAULT 0 CONSTRAINT usage_events_cache_miss_tokens_not_null1 NOT NULL,
    output_tokens integer DEFAULT 0 CONSTRAINT usage_events_output_tokens_not_null1 NOT NULL,
    images integer DEFAULT 0 NOT NULL,
    seconds integer DEFAULT 0 NOT NULL,
    cost_nano bigint DEFAULT 0 NOT NULL
)
PARTITION BY RANGE (created_at);
CREATE SEQUENCE public.usage_events_id_seq1
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.usage_events_id_seq1 OWNED BY public.usage_events.id;
ALTER TABLE public.usage_events ALTER COLUMN id SET DEFAULT nextval('public.usage_events_id_seq1'::regclass);
CREATE INDEX ix_usage_events_home_time ON public.usage_events USING btree (workspace_id, created_at);
CREATE INDEX ix_usage_events_id ON public.usage_events USING btree (id);
CREATE INDEX ix_usage_events_time ON public.usage_events USING brin (created_at);

CREATE TABLE public.usage_jobs (
    id bigint NOT NULL,
    job character varying(20) NOT NULL,
    period character varying(10) NOT NULL,
    state character varying(12) DEFAULT 'running'::character varying NOT NULL,
    server character varying(120) DEFAULT ''::character varying NOT NULL,
    claimed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    done_at timestamp with time zone,
    details jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE SEQUENCE public.usage_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.usage_jobs_id_seq OWNED BY public.usage_jobs.id;
ALTER TABLE ONLY public.usage_jobs ALTER COLUMN id SET DEFAULT nextval('public.usage_jobs_id_seq'::regclass);
ALTER TABLE ONLY public.usage_jobs
    ADD CONSTRAINT usage_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.usage_jobs
    ADD CONSTRAINT ux_usage_jobs_period UNIQUE (job, period);

CREATE TABLE public.usage_monthly (
    workspace_id bigint DEFAULT 0 NOT NULL,
    month date NOT NULL,
    bot_id bigint DEFAULT 0 NOT NULL,
    user_id bigint DEFAULT 0 NOT NULL,
    kind character varying(20) NOT NULL,
    id bigint NOT NULL,
    bot_name character varying(80),
    calls integer DEFAULT 0 NOT NULL,
    estimated_calls integer DEFAULT 0 NOT NULL,
    cache_hit_tokens bigint DEFAULT 0 NOT NULL,
    cache_miss_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    images integer DEFAULT 0 NOT NULL,
    seconds bigint DEFAULT 0 NOT NULL,
    cost_nano bigint DEFAULT 0 NOT NULL
)
WITH (fillfactor='80', autovacuum_vacuum_scale_factor='0.02', autovacuum_analyze_scale_factor='0.02');
CREATE SEQUENCE public.usage_monthly_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.usage_monthly_id_seq OWNED BY public.usage_monthly.id;
ALTER TABLE ONLY public.usage_monthly ALTER COLUMN id SET DEFAULT nextval('public.usage_monthly_id_seq'::regclass);
ALTER TABLE ONLY public.usage_monthly
    ADD CONSTRAINT usage_monthly_pkey PRIMARY KEY (workspace_id, id);
CREATE INDEX ix_usage_monthly_id ON public.usage_monthly USING btree (id);
CREATE UNIQUE INDEX ux_usage_monthly_key ON public.usage_monthly USING btree (workspace_id, month, bot_id, user_id, kind);

CREATE TABLE public.user_plugins (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    plugin_id character varying(64) NOT NULL,
    installed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.user_plugins_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.user_plugins_id_seq OWNED BY public.user_plugins.id;
ALTER TABLE ONLY public.user_plugins ALTER COLUMN id SET DEFAULT nextval('public.user_plugins_id_seq'::regclass);
ALTER TABLE ONLY public.user_plugins
    ADD CONSTRAINT uq_user_plugins UNIQUE (user_id, plugin_id);
ALTER TABLE ONLY public.user_plugins
    ADD CONSTRAINT user_plugins_pkey PRIMARY KEY (id);

CREATE TABLE public.user_skills (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    name character varying(80) NOT NULL,
    description character varying(240) DEFAULT ''::character varying NOT NULL,
    instructions text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.user_skills_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.user_skills_id_seq OWNED BY public.user_skills.id;
ALTER TABLE ONLY public.user_skills ALTER COLUMN id SET DEFAULT nextval('public.user_skills_id_seq'::regclass);
ALTER TABLE ONLY public.user_skills
    ADD CONSTRAINT user_skills_pkey PRIMARY KEY (id);
CREATE INDEX ix_user_skills_user ON public.user_skills USING btree (user_id);

CREATE TABLE public.vault_items (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    kind character varying(20) NOT NULL,
    label character varying(120) DEFAULT ''::character varying NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.vault_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.vault_items_id_seq OWNED BY public.vault_items.id;
ALTER TABLE ONLY public.vault_items ALTER COLUMN id SET DEFAULT nextval('public.vault_items_id_seq'::regclass);
ALTER TABLE ONLY public.vault_items
    ADD CONSTRAINT vault_items_pkey PRIMARY KEY (id);
CREATE INDEX ix_vault_items_user ON public.vault_items USING btree (user_id);
`;

const FUNCTIONS = String.raw`
CREATE FUNCTION public.bot_messages_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    begin
      new.changed := pg_current_xact_id();
      return new;
    end
    $$;

CREATE FUNCTION public.mercbot_charge_partitions(now_at timestamp with time zone, keep_days integer) RETURNS void
    LANGUAGE plpgsql
    AS $_$
declare
  today date := (now_at at time zone 'UTC')::date;
  this_month date := date_trunc('month', now_at at time zone 'UTC')::date;
  d date;
  m date;
  child record;
begin
  -- One server at a time: two creating the same partition at once would collide.
  perform pg_advisory_xact_lock(hashtext('mercbot_charge_partitions'));
  -- The daily totals' months before the per-call days, the order a settlement writes them in, so the two never wait
  -- on each other.
  for m in select generate_series(this_month - interval '1 month', this_month + interval '2 months', interval '1 month')::date loop
    perform mercbot_usage_daily_partition(m);
  end loop;
  for d in select generate_series(today - 1, today + 30, interval '1 day')::date loop
    execute format(
      'create table if not exists %I partition of usage_events for values from (%L) to (%L)',
      'usage_events_' || to_char(d, 'YYYYMMDD'),
      d::timestamp at time zone 'UTC',
      (d + 1)::timestamp at time zone 'UTC'
    );
  end loop;
  -- Per-call days past their keep are dropped whole, never deleted row by row.
  for child in
    select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'usage_events'::regclass and c.relname ~ '^usage_events_[0-9]{8}$'
  loop
    if to_date(substr(child.relname, 14), 'YYYYMMDD') < today - keep_days then
      execute format('drop table if exists %I', child.relname);
    end if;
  end loop;
end
$_$;

CREATE FUNCTION public.mercbot_usage_daily_partition(month_start date) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  if to_regclass('usage_daily_' || to_char(month_start, 'YYYYMM')) is null then
    execute format(
      'create table %I partition of usage_daily for values from (%L) to (%L) with (fillfactor = 80, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02)',
      'usage_daily_' || to_char(month_start, 'YYYYMM'),
      date_trunc('month', month_start)::date,
      (date_trunc('month', month_start) + interval '1 month')::date
    );
  end if;
end
$$;

CREATE TRIGGER bot_messages_changed BEFORE UPDATE ON public.bot_messages FOR EACH ROW EXECUTE FUNCTION public.bot_messages_changed();
`;

// The agent engine's tables (@jskit-ai/agent-runtime) hold each run and goal with its home, bot and person.
const AGENT_TABLES = String.raw`
ALTER TABLE public.agent_goals
    ADD COLUMN workspace_id bigint NOT NULL,
    ADD COLUMN bot_id bigint NOT NULL,
    ADD COLUMN user_id bigint NOT NULL;

ALTER TABLE public.agent_runs
    ADD COLUMN bot_id bigint NOT NULL;
`;

const FOREIGN_KEYS = String.raw`
ALTER TABLE ONLY public.agent_commands
    ADD CONSTRAINT agent_commands_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_goals
    ADD CONSTRAINT agent_goals_bot_id_foreign FOREIGN KEY (bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_goals
    ADD CONSTRAINT agent_goals_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_goals
    ADD CONSTRAINT agent_goals_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_goals
    ADD CONSTRAINT agent_goals_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_bot_id_foreign FOREIGN KEY (bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_summaries
    ADD CONSTRAINT agent_summaries_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_summary_queue
    ADD CONSTRAINT agent_summary_queue_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.any_field_configs
    ADD CONSTRAINT any_field_configs_resource_config_id_foreign FOREIGN KEY (resource_config_id) REFERENCES public.any_resource_configs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.any_relationship_configs
    ADD CONSTRAINT any_relationship_configs_resource_config_id_foreign FOREIGN KEY (resource_config_id) REFERENCES public.any_resource_configs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_fields
    ADD CONSTRAINT app_fields_table_id_foreign FOREIGN KEY (table_id) REFERENCES public.app_tables(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_fields
    ADD CONSTRAINT app_fields_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_interest
    ADD CONSTRAINT app_interest_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_jobs
    ADD CONSTRAINT app_jobs_bot_id_foreign FOREIGN KEY (bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_jobs
    ADD CONSTRAINT app_jobs_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_jobs
    ADD CONSTRAINT app_jobs_watch_id_foreign FOREIGN KEY (watch_id) REFERENCES public.app_watches(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.app_jobs
    ADD CONSTRAINT app_jobs_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_pins
    ADD CONSTRAINT app_pins_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_pins
    ADD CONSTRAINT app_pins_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_pins
    ADD CONSTRAINT app_pins_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_practices
    ADD CONSTRAINT app_practices_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_practices
    ADD CONSTRAINT app_practices_version_id_foreign FOREIGN KEY (version_id) REFERENCES public.app_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_practices
    ADD CONSTRAINT app_practices_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_script_rounds
    ADD CONSTRAINT app_script_rounds_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_script_rounds
    ADD CONSTRAINT app_script_rounds_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_script_runs
    ADD CONSTRAINT app_script_runs_script_id_foreign FOREIGN KEY (script_id) REFERENCES public.app_scripts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_script_runs
    ADD CONSTRAINT app_script_runs_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_scripts
    ADD CONSTRAINT app_scripts_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_scripts
    ADD CONSTRAINT app_scripts_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_builder_bot_id_foreign FOREIGN KEY (builder_bot_id) REFERENCES public.bots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_tables
    ADD CONSTRAINT app_tables_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_themes
    ADD CONSTRAINT app_themes_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_versions
    ADD CONSTRAINT app_versions_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_versions
    ADD CONSTRAINT app_versions_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_watches
    ADD CONSTRAINT app_watches_bot_id_foreign FOREIGN KEY (bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_watches
    ADD CONSTRAINT app_watches_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_watches
    ADD CONSTRAINT app_watches_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_web_access
    ADD CONSTRAINT app_web_access_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.approval_rules
    ADD CONSTRAINT approval_rules_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.approval_rules
    ADD CONSTRAINT approval_rules_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_made_by_bot_id_foreign FOREIGN KEY (made_by_bot_id) REFERENCES public.bots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_made_by_user_id_foreign FOREIGN KEY (made_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_browser_state
    ADD CONSTRAINT bot_browser_state_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_browser_state
    ADD CONSTRAINT bot_browser_state_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_computers
    ADD CONSTRAINT bot_computers_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_computers
    ADD CONSTRAINT bot_computers_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_bot_id_foreign FOREIGN KEY (bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_created_by_foreign FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_group_id_foreign FOREIGN KEY (group_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_parent_id_foreign FOREIGN KEY (parent_id) REFERENCES public.bot_conversations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_room_id_foreign FOREIGN KEY (room_id) REFERENCES public.bot_conversations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_section_id_foreign FOREIGN KEY (section_id) REFERENCES public.bot_sections(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_group_members
    ADD CONSTRAINT bot_group_members_bot_id_foreign FOREIGN KEY (bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_group_members
    ADD CONSTRAINT bot_group_members_group_id_foreign FOREIGN KEY (group_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_group_members
    ADD CONSTRAINT bot_group_members_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_group_people
    ADD CONSTRAINT bot_group_people_added_by_foreign FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bot_group_people
    ADD CONSTRAINT bot_group_people_group_id_foreign FOREIGN KEY (group_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_group_people
    ADD CONSTRAINT bot_group_people_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_group_people
    ADD CONSTRAINT bot_group_people_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_messages
    ADD CONSTRAINT bot_messages_bot_id_foreign FOREIGN KEY (bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_messages
    ADD CONSTRAINT bot_messages_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_messages
    ADD CONSTRAINT bot_messages_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_notebook
    ADD CONSTRAINT bot_notebook_bot_id_foreign FOREIGN KEY (bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_notebook
    ADD CONSTRAINT bot_notebook_source_conversation_id_foreign FOREIGN KEY (source_conversation_id) REFERENCES public.bot_conversations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bot_notebook
    ADD CONSTRAINT bot_notebook_source_user_id_foreign FOREIGN KEY (source_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bot_notebook
    ADD CONSTRAINT bot_notebook_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_policies
    ADD CONSTRAINT bot_policies_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_policies
    ADD CONSTRAINT bot_policies_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT bot_requests_from_bot_id_foreign FOREIGN KEY (from_bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT bot_requests_from_conversation_id_foreign FOREIGN KEY (from_conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT bot_requests_parent_id_foreign FOREIGN KEY (parent_id) REFERENCES public.bot_requests(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT bot_requests_to_bot_id_foreign FOREIGN KEY (to_bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT bot_requests_to_conversation_id_foreign FOREIGN KEY (to_conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT bot_requests_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT bot_requests_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_routines
    ADD CONSTRAINT bot_routines_bot_id_foreign FOREIGN KEY (bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_routines
    ADD CONSTRAINT bot_routines_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_routines
    ADD CONSTRAINT bot_routines_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_sections
    ADD CONSTRAINT bot_sections_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_sections
    ADD CONSTRAINT bot_sections_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bots
    ADD CONSTRAINT bots_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bots
    ADD CONSTRAINT bots_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bridge_link
    ADD CONSTRAINT bridge_link_linked_by_foreign FOREIGN KEY (linked_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.computer_tickets
    ADD CONSTRAINT computer_tickets_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.computer_tickets
    ADD CONSTRAINT computer_tickets_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.connect_follow_ups
    ADD CONSTRAINT connect_follow_ups_message_id_foreign FOREIGN KEY (message_id) REFERENCES public.bot_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.connect_follow_ups
    ADD CONSTRAINT connect_follow_ups_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.conversation_reads
    ADD CONSTRAINT conversation_reads_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.conversation_reads
    ADD CONSTRAINT conversation_reads_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.file_storage
    ADD CONSTRAINT file_storage_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.page_versions
    ADD CONSTRAINT page_versions_bot_id_foreign FOREIGN KEY (bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.page_versions
    ADD CONSTRAINT page_versions_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.person_memories
    ADD CONSTRAINT person_memories_bot_id_foreign FOREIGN KEY (bot_id) REFERENCES public.bots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.person_memories
    ADD CONSTRAINT person_memories_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.person_memories
    ADD CONSTRAINT person_memories_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.plugin_accounts
    ADD CONSTRAINT plugin_accounts_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.plugin_accounts
    ADD CONSTRAINT plugin_accounts_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.plugin_actions_off
    ADD CONSTRAINT plugin_actions_off_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.shell_runs
    ADD CONSTRAINT shell_runs_bot_id_foreign FOREIGN KEY (bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.shell_runs
    ADD CONSTRAINT shell_runs_conversation_id_foreign FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.shell_runs
    ADD CONSTRAINT shell_runs_workspace_id_foreign FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_plugins
    ADD CONSTRAINT user_plugins_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_skills
    ADD CONSTRAINT user_skills_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.vault_items
    ADD CONSTRAINT vault_items_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
`;

const TABLE_NAMES = Object.freeze([
  "any_field_configs", "any_links", "any_records", "any_relationship_configs", "any_resource_configs",
  "app_fields", "app_interest", "app_jobs", "app_pins", "app_practices", "app_script_rounds", "app_script_runs",
  "app_scripts", "app_settings", "app_tables", "app_themes", "app_versions", "app_watches", "app_web_access",
  "approval_rules", "apps", "audit_events", "bot_browser_state", "bot_computers", "bot_conversations",
  "bot_group_members", "bot_group_people", "bot_messages", "bot_notebook", "bot_policies", "bot_requests",
  "bot_routines", "bot_sections", "bots", "bridge_link", "computer_days", "computer_tickets",
  "connect_follow_ups", "connector_apps", "conversation_reads", "file_storage", "mercbot_servers",
  "mercbot_settings", "oauth_states", "page_versions", "person_memories", "plugin_accounts", "plugin_actions_off",
  "shell_runs", "usage_daily", "usage_events", "usage_jobs", "usage_monthly", "user_plugins", "user_skills",
  "vault_items"
]);

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.raw(TABLES);
  await knex.raw(FUNCTIONS);
  await knex.raw(AGENT_TABLES);
  await knex.raw(FOREIGN_KEYS);
  // The usage tables' partitions: the daily totals' months around now, and the per-call days kept (14) and ahead.
  await knex.raw("select mercbot_charge_partitions(now() - interval '14 days', 14)");
  await knex.raw("select mercbot_charge_partitions(now(), 14)");
};

/**
 * Removes all of it: the agent engine's added columns, the tables (their partitions, sequences and keys go with them)
 * and the functions.
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE public.agent_goals DROP COLUMN workspace_id, DROP COLUMN bot_id, DROP COLUMN user_id");
  await knex.raw("ALTER TABLE public.agent_runs DROP COLUMN bot_id");
  for (const table of [...TABLE_NAMES].reverse()) await knex.raw("drop table if exists ?? cascade", [table]);
  await knex.raw("DROP FUNCTION IF EXISTS public.bot_messages_changed()");
  await knex.raw("DROP FUNCTION IF EXISTS public.mercbot_charge_partitions(now_at timestamp with time zone, keep_days integer)");
  await knex.raw("DROP FUNCTION IF EXISTS public.mercbot_usage_daily_partition(month_start date)");
};
