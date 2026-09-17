-- =====================================================================
-- CLiQ Push Operations - CRM logic layer
-- Run this FOURTH, after 03_seed.sql.
-- Everything here comes from the CRM Automation and Segments_Moe workbooks:
-- the live MoEngage segment library, the offer decision factors, the
-- tag / group / collapse mapping, and the channel revenue mix.
-- =====================================================================

-- ---------- channel mix (revenue contribution of CRM) ----------
do $$ begin
  create type push_channel as enum ('PN','WHATSAPP','EMAIL','SMS','APP_INBOX','WEB_PUSH');
exception when duplicate_object then null; end $$;

create table if not exists channels (
  code push_channel primary key,
  label text not null,
  revenue_share numeric(4,3) not null,
  notes text
);

insert into channels (code, label, revenue_share, notes) values
  ('PN',        'Push notification', 0.700, 'Primary CRM channel — over 70% of CRM revenue contribution.'),
  ('WHATSAPP',  'WhatsApp',          0.220, 'Second channel by contribution, roughly 22%.'),
  ('SMS',       'SMS',               0.040, 'Around 4% of contribution.'),
  ('EMAIL',     'Email',             0.030, 'Between 1% and 3%. Growth channel — new users take time to warm up.'),
  ('APP_INBOX', 'App inbox',         0.005, 'Support channel, usually paired with a PN.'),
  ('WEB_PUSH',  'Web push',          0.005, 'Support channel for desktop sessions.')
on conflict (code) do update set revenue_share = excluded.revenue_share, notes = excluded.notes;

-- ---------- MoEngage segment library ----------
create table if not exists segments (
  id uuid primary key default gen_random_uuid(),
  moe_name text not null unique,
  ct_name text,
  display_name text not null,
  segment_family text not null,          -- Predominance / Behaviour / Lifecycle / Location / Search / Value / Email
  gender text,                           -- WOMEN / MEN / ALL
  catalogue_codes text,                  -- L1 / L2 codes this segment maps to
  definition text,                       -- the MoEngage rule, verbatim from the sheet
  base_count bigint,
  platform text default 'Both',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Standard exclusions applied to every push segment.
create table if not exists segment_exclusions (
  id serial primary key,
  label text not null unique,
  rationale text
);

insert into segment_exclusions (label, rationale) values
  ('Notification clicked in last 12 hours', 'Avoids re-hitting a user who just engaged.'),
  ('Tata internal users',                   'Employee and test accounts must never receive live pushes.'),
  ('Order placed in last 7 days',           'Recent purchasers are suppressed from acquisition-style pushes.')
on conflict (label) do nothing;

insert into segments (moe_name, ct_name, display_name, segment_family, gender, catalogue_codes, definition, base_count) values
  ('Predom_WomenApparel45D_27May','Predom_WomenApparel45D_23July','Women''s apparel — predominant 45D','Predominance','WOMEN','MSH10','Product Viewed predominantly in Women''s Apparel in the last 45 days, excluding recent purchasers of the same L1.',392770),
  ('Predom_Westside45D_27May','Predom_Westside45D_22July','Westside browsers — predominant 45D','Predominance','ALL','Westside','Product Viewed predominantly where Brand Name contains Westside in the last 45 days, excluding Westside purchasers in the last 7 days.',351000),
  ('Predom_MenFW45D_27May','Predom_MenFW45D_23July','Men''s footwear — predominant 45D','Predominance','MEN','MSH1311','Product Viewed predominantly in Men''s Footwear in the last 45 days.',327508),
  ('Predom_MenApparel45D_27May','Predom_MenApparel45D_22July','Men''s apparel — predominant 45D','Predominance','MEN','MSH11','Product Viewed predominantly in Men''s Apparel in the last 45 days.',202236),
  ('Predom_WomenFW45D_27May','Predom_WomenFW45D_23July','Women''s footwear — predominant 45D','Predominance','WOMEN','MSH1310','Product Viewed predominantly in Women''s Footwear in the last 45 days.',90980),
  ('Predom_Home45D_27May','Predom_Home45D_23July','Home — predominant 45D','Predominance','ALL','MSH22','Product Viewed predominantly in Home in the last 45 days.',88699),
  ('Predom_Watches45D_27May','Predom_Watches45D_23July','Watches — predominant 45D','Predominance','ALL','MSH15','Product Viewed predominantly in Watches in the last 45 days.',84453),
  ('Predom_Acc45D_27May','Predom_Acc45D_23July','Accessories — predominant 45D','Predominance','ALL','MSH16','Product Viewed predominantly in Accessories in the last 45 days.',73075),
  ('Predom_FineJewell45D_27May','Predom_FineJewell45D_23July','Fine jewellery — predominant 45D','Predominance','ALL','MSH2010-2018','Product Viewed predominantly in Fine Jewellery in the last 45 days.',69903),
  ('Predom_Beauty&Groom45D_27May','Predom_Beauty&Groom45D_23July','Beauty and grooming — predominant 45D','Predominance','ALL','MSH25','Product Viewed predominantly in Beauty and Grooming in the last 45 days.',59499),
  ('Predom_FashionJewell45D_27May','Predom_FashionJewell45D_23July','Fashion jewellery — predominant 45D','Predominance','ALL','MSH2016-2018','Product Viewed predominantly in Fashion Jewellery in the last 45 days.',35491),
  ('Predom_ETX45D_27May','Predom_ETX45D_23July','Electronics — predominant 45D','Predominance','ALL','MSH12','Product Viewed predominantly in Electronics in the last 45 days.',24863),
  ('Predom_Kids45D_2yMay','Predom_Kids45D_23July','Kids — predominant 45D','Predominance','ALL','MSH21','Product Viewed predominantly in Kids in the last 45 days.',22571),
  ('Predom_Eyewear45D_27May','Predom_Eyewear45D_23July','Eyewear — predominant 45D','Predominance','ALL','MSH24','Product Viewed predominantly in Eyewear in the last 45 days.',8927),
  ('Predom_WomAcc45D_30JAN',null,'Women''s accessories — predominant 45D','Predominance','WOMEN','MSH1600-1604','Product Viewed predominantly in Women''s Accessories L2 codes in the last 45 days.',108952),
  ('Predom_MenAcc45D_30JAN',null,'Men''s accessories — predominant 45D','Predominance','MEN','MSH1604-1606','Product Viewed predominantly in Men''s Accessories L2 codes in the last 45 days.',74738),

  ('Push_MenSeg_06June25',null,'Men — broad push base','Lifecycle','MEN',null,'App or site opened at least once in the last 45 days, or an order placed since Jan 2021, combined with the men''s shopper custom segments.',1421461),
  ('Push_WomenSeg1_06June25',null,'Women — broad push base','Lifecycle','WOMEN','MSH10, MSH20, MSH24, MSH25','Gender or predicted gender is female, or product viewed in women''s L1 codes in the last 45 days.',1009594),
  ('INB_160625',null,'Inactive base — no order in 12 months','Lifecycle','ALL',null,'Has not executed Order Placed in the last 12 months.',2144816),
  ('Same_month_shoppers_15june',null,'Same-month shoppers','Lifecycle','ALL',null,'Order placed at least once in the last 30 days.',99372),

  ('Applaunch10pmto12am_27may',null,'Night browsers — 10pm to 12am','Behaviour','ALL',null,'App or site opened predominantly between 10 PM and 12 AM over the last 30 days.',671041),
  ('Applaunch12amto2am_27may',null,'Late-night browsers — 12am to 2am','Behaviour','ALL',null,'App or site opened predominantly between 12 AM and 2 AM over the last 30 days.',335223),
  ('Applaunch5am8am_27may',null,'Early-morning browsers — 5am to 8am','Behaviour','ALL',null,'App or site opened predominantly between 5 AM and 8 AM over the last 30 days.',312195),
  ('Browsing_upperfunnel_100625',null,'Upper-funnel browsers — product view drop-off','Behaviour','ALL',null,'Upper-funnel product viewed across core L3 catalogue codes, excluding Westside.',325499),

  ('Cliqcash_greaterthan_51',null,'CliQ Cash balance over ₹51','Value','ALL',null,'CliQ Cash reporting date is today and balance is greater than 51.',467800),
  ('WomenPremium_15July25',null,'Premium women','Value','WOMEN',null,'Warehouse SQL cohort of premium women shoppers.',null),
  ('PremiumMen_15July25',null,'Premium men','Value','MEN',null,'Warehouse SQL cohort of premium men shoppers.',null),

  ('South_Base_Dec2025',null,'Southern India base','Location','ALL',null,'Last known state or city in Karnataka, Telangana, Tamil Nadu, Kerala, Andhra Pradesh and their metros.',2089463),
  ('Northern_Location',null,'Northern India base','Location','ALL',null,'Last known state across the northern belt including Delhi NCR, UP, Rajasthan, Punjab and Haryana.',null),
  ('Men_Northern_location_05 Jan2026',null,'Men — northern India','Location','MEN',null,'Male gender combined with the northern state and city list.',158800),
  ('Wom_Northern_location_21 Jan2026',null,'Women — northern India','Location','WOMEN',null,'Female gender combined with the northern state and city list.',272856),

  ('Search_Watch_16Sep',null,'Searched watches — 90D','Search','ALL',null,'User Search at least once in the last 90 days for watch terms.',null),
  ('search_kids_040825',null,'Searched kids — 90D','Search','ALL',null,'User Search at least once in the last 90 days for kids terms.',null),
  ('Search_Sports',null,'Searched sports footwear — 30D','Search','ALL',null,'User Search at least once in the last 30 days across sports shoe terms.',null),

  ('email_not_opened',null,'Email — delivered but never opened','Email','ALL',null,'Email delivered 30 or more times since Sep 2024 with no open since.',6566346),
  ('opened_not_clicked_26sept',null,'Email — opened but never clicked','Email','ALL',null,'Email opened 15 or more times since Sep 2024 with no click since.',1755728),
  ('active_email_segment_26sept',null,'Email — active and reachable','Email','ALL',null,'All users excluding hard bounce, spam, unsubscribe, never-opened and opened-not-clicked.',22702699)
on conflict (moe_name) do nothing;

-- ---------- named cohorts (workbook Sheet2) ----------
create table if not exists cohorts (
  id serial primary key,
  name text not null unique,
  definition text not null,
  exclusion text
);

insert into cohorts (name, definition, exclusion) values
  ('High Value Customers','AOV of ₹6,000 or more with 3 or more orders, never shopped Westside.',null),
  ('Westside Exclusive Shoppers','More than 3 orders where the last order was Westside, but no transaction on Tata CLiQ in the past 3 months.',null),
  ('Westside Dormant','Neither purchased nor browsed Westside in the last 6 months.',null),
  ('One Time Westside Purchaser','Shopped Westside exactly once in lifetime.',null),
  ('Two Time Westside Purchaser','Shopped Westside twice in lifetime.','Shoppers in the last 7 days'),
  ('Westside Loyalist','Shopped Westside more than 5 times in lifetime.','Shoppers in the last 15 days')
on conflict (name) do nothing;

-- ---------- offer decision factors (LOGIC SCENARIOS) ----------
create table if not exists offer_factors (
  id serial primary key,
  factor text not null unique,
  why_it_matters text not null,
  offer_implication text not null,
  is_priority boolean not null default false
);

insert into offer_factors (factor, why_it_matters, offer_implication, is_priority) values
  ('LTV','Indicates customer value','High LTV — offer exclusives and early access rather than discount', true),
  ('Recency','Shows engagement level','Lapsed users need win-back offers', true),
  ('CVR','Measures purchase propensity','Low CVR — a higher offer is justified', true),
  ('Margin %','Protects profitability','High margin allows a deeper offer', true),
  ('Category Affinity','Relevant offers convert better','Personalise the offer by category', true),
  ('Brand Affinity','Reflects brand preference','Serve brand-specific offers', true),
  ('RPV','Measures revenue efficiency','High RPV — a lower discount will still convert', false),
  ('AOV','Determines basket size','Use threshold offers for high AOV baskets', false),
  ('Frequency','Indicates loyalty','Frequent buyers respond to loyalty rewards', false),
  ('Cart / Browse Intent','Signals purchase intent','High intent needs only a small coupon', false),
  ('Inventory Health','Helps clear stock','Overstock justifies an aggressive offer', false),
  ('Brand Funding','Subsidises the discount cost','Higher brand funding allows a better offer', false),
  ('Price Sensitivity','Measures discount dependence','Sensitive users need discount-led offers', false),
  ('Churn Risk','Predicts likelihood to lapse','High risk needs a strong win-back incentive', false),
  ('Channel ROI','Channels perform differently','Vary the offer by push, WhatsApp or email', false)
on conflict (factor) do nothing;

-- ---------- segment to typical offer construct ----------
create table if not exists offer_playbook (
  id serial primary key,
  customer_segment text not null unique,
  typical_offer text not null
);

insert into offer_playbook (customer_segment, typical_offer) values
  ('New User','15–20% off, or a flat ₹ off construct'),
  ('Active User','Personalised category offer'),
  ('Cart Abandoner','5–10% off — intent is already high'),
  ('Lapsed User (60–120 days)','15–25% off as a win-back'),
  ('VIP / High LTV','Early access, gift or bonus points rather than discount'),
  ('Overstock Category Buyers','Higher discount to clear stock'),
  ('Premium Brand Shoppers','Value-adds over deep discounts')
on conflict (customer_segment) do nothing;

-- ---------- push ops fields (Tags / Group / Collapse) ----------
create table if not exists push_tags (
  id serial primary key,
  tag text not null unique,
  label text not null,
  group_id text not null
);

insert into push_tags (tag, label, group_id) values
  ('Beauty','Beauty and grooming','1111'),
  ('MenF','Men''s footwear','2222'),
  ('WomF','Women''s footwear','2222'),
  ('KidsF','Kids footwear','2222'),
  ('KidsAp','Kids apparel','3333'),
  ('MenA','Men''s apparel','3333'),
  ('WomAE','Women''s apparel — ethnic','4444'),
  ('WomAW','Women''s apparel — western','4444'),
  ('Daali','Daali','4444'),
  ('Home','Home','5555'),
  ('Watches','Watches','5555'),
  ('FashJew','Fashion jewellery','5555'),
  ('FineJew','Fine jewellery','5555'),
  ('Eye','Eyewear','5555'),
  ('Coins','Coins','5555'),
  ('Accesories','Accessories','5555'),
  ('Electronics','Electronics','5555'),
  ('Cliq cash','CliQ Cash','5555'),
  ('browsing','Browsing','5555'),
  ('intervention','Intervention','5555')
on conflict (tag) do nothing;

-- ---------- campaign columns for the real operational fields ----------
alter table campaigns add column if not exists channel push_channel not null default 'PN';
alter table campaigns add column if not exists segment_id uuid references segments(id);
alter table campaigns add column if not exists segment_2_id uuid references segments(id);
alter table campaigns add column if not exists push_tag text;
alter table campaigns add column if not exists group_id text;
alter table campaigns add column if not exists collapse_id text;
alter table campaigns add column if not exists global_limit boolean not null default true;
alter table campaigns add column if not exists sound boolean not null default false;
alter table campaigns add column if not exists pn_template text;
alter table campaigns add column if not exists access_type text;      -- onetime | earlyaccess
alter table campaigns add column if not exists offer_construct text;  -- from offer_playbook
alter table campaigns add column if not exists expected_reach bigint;

-- Group ID follows the tag, so it is derived rather than typed.
create or replace function public.sync_push_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.push_tag is not null then
    select group_id into new.group_id from push_tags where tag = new.push_tag;
  end if;
  return new;
end $$;

drop trigger if exists campaigns_sync_group on campaigns;
create trigger campaigns_sync_group
  before insert or update of push_tag on campaigns
  for each row execute function public.sync_push_group();

-- ---------- read policies ----------
alter table segments            enable row level security;
alter table segment_exclusions  enable row level security;
alter table cohorts             enable row level security;
alter table offer_factors       enable row level security;
alter table offer_playbook      enable row level security;
alter table push_tags           enable row level security;
alter table channels            enable row level security;

do $$
declare t text;
begin
  foreach t in array array['segments','segment_exclusions','cohorts','offer_factors','offer_playbook','push_tags','channels']
  loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select to authenticated using (true)', t);
    execute format('drop policy if exists %1$s_crm_write on %1$s', t);
    execute format('create policy %1$s_crm_write on %1$s for all to authenticated using (public.is_crm()) with check (public.is_crm())', t);
  end loop;
end $$;

-- ---------- attach realistic segments, tags and channels to seeded campaigns ----------
update campaigns c set
  segment_id = s.id,
  audience   = s.display_name,
  expected_reach = s.base_count,
  push_tag = t.tag,
  channel = (case when (abs(hashtext(c.id::text)::bigint) % 10) < 7 then 'PN'
                  when (abs(hashtext(c.id::text)::bigint) % 10) < 9 then 'WHATSAPP'
                  else 'EMAIL' end)::push_channel,
  access_type = case when c.priority in ('HIGH','CRITICAL') then 'earlyaccess' else 'onetime' end,
  pn_template = (array['Basic','Bezel','Timer','Coloured BG'])[1 + (abs(hashtext(c.id::text)::bigint) % 4)],
  offer_construct = p.typical_offer
from segments s, push_tags t, offer_playbook p
where s.moe_name = (case c.category
        when 'Beauty'      then 'Predom_Beauty&Groom45D_27May'
        when 'Fashion'     then 'Predom_WomenApparel45D_27May'
        when 'Luxury'      then 'WomenPremium_15July25'
        when 'Watches'     then 'Predom_Watches45D_27May'
        when 'Footwear'    then 'Predom_MenFW45D_27May'
        when 'Accessories' then 'Predom_Acc45D_27May'
        else 'Predom_FineJewell45D_27May' end)
  and t.tag = (case c.category
        when 'Beauty'      then 'Beauty'
        when 'Fashion'     then 'WomAW'
        when 'Luxury'      then 'FineJew'
        when 'Watches'     then 'Watches'
        when 'Footwear'    then 'MenF'
        when 'Accessories' then 'Accesories'
        else 'FashJew' end)
  and p.customer_segment = (case
        when c.campaign_origin = 'CRM_PLANNED' then 'Active User'
        when c.priority = 'CRITICAL'           then 'VIP / High LTV'
        else 'Premium Brand Shoppers' end);

select
  (select count(*) from segments)      as segments,
  (select count(*) from offer_factors) as offer_factors,
  (select count(*) from push_tags)     as push_tags,
  (select count(*) from campaigns where segment_id is not null) as campaigns_targeted;
