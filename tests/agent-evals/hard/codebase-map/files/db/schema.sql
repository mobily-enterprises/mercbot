create table companies (id serial primary key, name text not null);
create table users (id serial primary key, company_id int references companies, email text unique not null, password_hash text not null);
create table sessions (id text primary key, user_id int references users, expires_at timestamptz not null);
create table customers (id serial primary key, company_id int references companies, name text not null, email text, phone text, tax_exempt boolean default false, discount_percent numeric default 0);
create table invoices (id serial primary key, company_id int references companies, customer_id int references customers, due_date date, subtotal int, tax int, discount int, total int, status text, created_at timestamptz default now());
create table invoice_lines (id serial primary key, invoice_id int references invoices, description text, quantity numeric, unit_price numeric, tax int);
create table ledger_entries (id serial primary key, company_id int, invoice_id int, account text, debit int, credit int, created_at timestamptz default now());
create table email_outbox (id serial primary key, sender text, recipient text, subject text, body text, sent_at timestamptz);
create table sms_outbox (id serial primary key, phone text, text text, sent_at timestamptz);
