-- PASAR MINI - Skema PostgreSQL (production-ready)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','admin','staff')) DEFAULT 'staff',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY, name CITEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  sku CITEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category_id BIGINT REFERENCES categories(id),
  unit TEXT NOT NULL DEFAULT 'pcs',              -- pcs | kg | pack | liter
  buy_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  sell_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  stock NUMERIC(14,3) NOT NULL DEFAULT 0,
  min_stock NUMERIC(14,3) NOT NULL DEFAULT 0,
  perishable BOOLEAN NOT NULL DEFAULT FALSE,     -- ayam potong / paket sayur
  expiry_days INT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  name CITEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cash','bank','receivable','payable','equity','revenue','cogs','expense')),
  balance NUMERIC(16,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS ledger_seq START 1;

CREATE TABLE IF NOT EXISTS journal_entries (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  ref_type TEXT NOT NULL,       -- sale|purchase|expense|income|asset_buy|asset_sell|depreciation|adjustment|receipt
  ref_id   BIGINT,
  description TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger (
  id BIGSERIAL PRIMARY KEY,
  entry_id BIGINT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounts(id),
  debit NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  check (debit = 0 OR credit = 0)
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entry ON ledger(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(date);

CREATE TABLE IF NOT EXISTS sales (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  customer_id BIGINT REFERENCES customers(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','transfer','qris','credit')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
  subtotal NUMERIC(16,2) NOT NULL DEFAULT 0,
  discount NUMERIC(16,2) NOT NULL DEFAULT 0,
  tax NUMERIC(16,2) NOT NULL DEFAULT 0,
  total NUMERIC(16,2) NOT NULL DEFAULT 0,
  paid NUMERIC(16,2) NOT NULL DEFAULT 0,
  change NUMERIC(16,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sale_items (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(14,2) NOT NULL,
  cogs_unit NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(16,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

CREATE TABLE IF NOT EXISTS purchases (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  supplier_id BIGINT REFERENCES suppliers(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','transfer','credit')),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('draft','received','voided')),
  total NUMERIC(16,2) NOT NULL DEFAULT 0,
  paid NUMERIC(16,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id BIGSERIAL PRIMARY KEY,
  purchase_id BIGINT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(14,2) NOT NULL,
  total NUMERIC(16,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL,
  amount NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  description TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incomes (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL,
  amount NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  description TEXT,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assets (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  purchase_date DATE NOT NULL,
  purchase_price NUMERIC(16,2) NOT NULL,
  useful_life_months INT NOT NULL DEFAULT 48,
  salvage_value NUMERIC(16,2) NOT NULL DEFAULT 0,
  depreciation_method TEXT NOT NULL DEFAULT 'straight_line' CHECK (depreciation_method IN ('straight_line','none')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','disposed')),
  location TEXT, notes TEXT,
  sold_date DATE, sold_price NUMERIC(16,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL,      -- purchase|sale|adjustment|opname|return
  qty NUMERIC(14,3) NOT NULL,   -- positif masuk, negatif keluar
  ref_type TEXT, ref_id BIGINT, note TEXT,
  created_by BIGINT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS receipts (
  id BIGSERIAL PRIMARY KEY,
  image_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','confirmed','failed')),
  engine TEXT,                          -- google_vision | internal
  raw_text TEXT,
  parsed JSONB,
  confidence NUMERIC(5,2),
  converted_purchase_id BIGINT REFERENCES purchases(id),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  jti UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id BIGINT,
  meta JSONB, created_at TIMESTAMPTZ DEFAULT now()
);
