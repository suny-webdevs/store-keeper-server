-- Search + attributes GIN indexes
CREATE INDEX products_attributes_gin ON products USING GIN (attributes);
ALTER TABLE products ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(sku,''))) STORED;
CREATE INDEX products_search_idx ON products USING GIN (search_tsv);

-- Non-negative constraints
ALTER TABLE product_branch_stock
  ADD CONSTRAINT pbs_nonneg CHECK (qty_on_hand >= 0 AND qty_reserved >= 0);

-- Cursor-pagination indexes
CREATE INDEX idx_ledger_branch_id_desc ON inventory_ledger (branch_id, id DESC);
CREATE INDEX idx_sales_branch_confirmed_at ON sales (branch_id, confirmed_at DESC)
  WHERE status = 'CONFIRMED';

-- Analytics materialized views
CREATE MATERIALIZED VIEW mv_sales_daily AS
SELECT tenant_id, branch_id, date_trunc('day', confirmed_at)::date AS sale_date,
       COUNT(*) AS sale_count, SUM(total) AS revenue, SUM(discount) AS discount_total
FROM sales WHERE status = 'CONFIRMED'
GROUP BY 1,2,3 WITH NO DATA;
CREATE UNIQUE INDEX ON mv_sales_daily (tenant_id, branch_id, sale_date);

CREATE MATERIALIZED VIEW mv_profit_loss_daily AS
SELECT s.tenant_id, s.branch_id, si.product_id,
       date_trunc('day', s.confirmed_at)::date AS sale_date,
       SUM(si.qty) AS qty_sold, SUM(si.line_total) AS revenue,
       SUM(si.unit_cost * si.qty) AS cogs, SUM(si.line_profit) AS profit
FROM sale_items si JOIN sales s ON s.id = si.sale_id
WHERE s.status = 'CONFIRMED'
GROUP BY 1,2,3,4 WITH NO DATA;
CREATE UNIQUE INDEX ON mv_profit_loss_daily (tenant_id, branch_id, product_id, sale_date);

CREATE MATERIALIZED VIEW mv_stock_valuation_daily AS
SELECT pbs.branch_id, current_date AS snapshot_date,
       SUM(pbs.qty_on_hand * pbs.wac) AS stock_value
FROM product_branch_stock pbs GROUP BY 1 WITH NO DATA;
CREATE UNIQUE INDEX ON mv_stock_valuation_daily (branch_id, snapshot_date);
