-- =====================================================================
-- CLiQ Push Ops — Slot restructure + PN CC logic
-- Run this FIFTH. Rebuilds the slot model around the real PN CC structure:
--   ~90 fixed time slots per day, multiple PNs per slot,
--   Segment+Category as a synchronized pair, daily shuffle.
-- =====================================================================

-- ---------- new segment cohort table (PN CC segments) ----------
create table if not exists pncc_segments (
  id serial primary key,
  condition_label text not null,
  segment_name text not null unique,
  gender text,
  is_active boolean not null default true
);

truncate table pncc_segments restart identity cascade;

insert into pncc_segments (condition_label, segment_name, gender) values
  ('Active Repeat Women','ActRpt_Wom_10July26','WOMEN'),
  ('Active Repeat Rest','ActRpt_Rest_10July26',null),
  ('Repeat Women','Rep_Wom_10July26','WOMEN'),
  ('Repeat Rest','Rep_Rest_10July26',null),
  ('RingFence Women','RFRep_Wom_10July26','WOMEN'),
  ('RingFence Rest','RFRep_Rest_10July26',null),
  ('Dormant Women','Drmnt_Wom_10July26','WOMEN'),
  ('Dormant','Drmnt_Rest_10July26',null),
  ('INB Women','INB_Wom_10July26','WOMEN'),
  ('INB Rest','INB_Rest_10July26',null),
  ('INB Men','INB_Men_10July26','MEN'),
  ('Repeat Men','Rep_Men_10July26','MEN'),
  ('Active Repeat Men','ActRpt_Men_10July26','MEN'),
  ('Active','Active_M1toM3_10July26',null),
  ('Repeat','Repeat_M4toM6_10July26',null),
  ('RF + Dormant','RF_Drmnt_10July26',null),
  ('Active Women','Active_Wom_10July26','WOMEN'),
  ('Active Men','Active_Men_10July26','MEN'),
  ('RF Men','RFRep_Men_10July26','MEN'),
  ('INB','INB_10July26',null),
  ('Dormant Men','Drmnt_Men_10July26','MEN'),
  ('Shopper','Shopper_10July26',null),
  ('Non Shopper','Non_Shopper_10July26',null),
  ('Women','Push_Women_10July26','WOMEN'),
  ('Men','Push_Men_10July26','MEN'),
  ('HNI','Fashion_HNI_300626',null),
  ('Shopper Women','Shopper_Wom_10July26','WOMEN'),
  ('Shopper Men','Shopper_Men_10July26','MEN'),
  ('Non Shopper Women','NonShopper_Wom_10July26','WOMEN'),
  ('Non Shopper Men','NonShopper_Men_10July26','MEN'),
  ('Fullbase','Fullbase_10July26',null),
  ('Rest of the base','RestOfBase_10July26',null),
  ('Custom','Custom_10July26',null);

-- ---------- PN CC categories (the Tag column from Tags/Group/Collapse) ----------
create table if not exists pncc_categories (
  id serial primary key,
  code text not null unique,
  label text not null,
  group_id text
);

truncate table pncc_categories restart identity cascade;

insert into pncc_categories (code, label, group_id) values
  ('MenA','Men''s Apparel','3333'),
  ('MenF','Men''s Footwear','2222'),
  ('MenAcc','Men''s Accessories','5555'),
  ('WomAE','Women''s Apparel Ethnic','4444'),
  ('WomAW','Women''s Apparel Western','4444'),
  ('WomF','Women''s Footwear','2222'),
  ('WomAcc','Women''s Accessories','5555'),
  ('KidsA','Kids Apparel','3333'),
  ('KidsF','Kids Footwear','2222'),
  ('Westside','Westside','5555'),
  ('Watches','Watches','5555'),
  ('Beauty','Beauty','1111'),
  ('Fragrance','Fragrance','1111'),
  ('Non Fragrance','Non Fragrance','1111'),
  ('Home','Home','5555'),
  ('Electronics','Electronics','5555'),
  ('Eyewear','Eyewear','5555'),
  ('FineJew','Fine Jewellery','5555'),
  ('FashJew','Fashion Jewellery','5555'),
  ('Silver/Fashion Jew','Silver / Fashion Jewellery','5555'),
  ('Coins','Coins','5555'),
  ('H&W','Health & Wellness','5555'),
  ('Daali','Daali','4444');

-- ---------- approved segment+category pairs (from PN CC example) ----------
create table if not exists approved_pairs (
  id serial primary key,
  segment_label text not null,
  category_code text not null,
  unique(segment_label, category_code)
);

truncate table approved_pairs restart identity cascade;

-- Insert all unique pairs from the provided example
insert into approved_pairs (segment_label, category_code) values
  ('Men','MenA'),('Men','WomAE'),('Men','Westside'),('Men','MenF'),
  ('Men','Watches'),('Men','H&W'),('Men','Fragrance'),('Men','Non Fragrance'),
  ('Women','WomAE'),('Women','MenF'),('Women','Westside'),('Women','Watches'),
  ('Women','WomAcc'),('Women','WomAW'),('Women','Fragrance'),('Women','Non Fragrance'),
  ('Custom','Electronics'),('Custom','Home'),('Custom','Non Fragrance'),
  ('Custom','Eyewear'),('Custom','MenAcc'),('Custom','KidsA'),('Custom','KidsF'),
  ('Custom','WomF'),('Custom','WomAcc'),('Custom','Fragrance'),
  ('Rest of the base','Westside'),('Rest of the base','MenAcc'),('Rest of the base','MenA'),
  ('Rest of the base','WomAE'),('Rest of the base','FineJew'),('Rest of the base','WomAW'),
  ('Rest of the base','Home'),
  ('Fullbase','Westside'),('Fullbase','MenA'),
  ('INB','MenA'),('INB','Westside'),('INB','WomAE'),
  ('Repeat','Non Fragrance'),('Repeat','MenF'),
  ('RF + Dormant','WomAcc'),('RF + Dormant','MenAcc'),('RF + Dormant','MenF'),
  ('Shopper','Watches'),('Shopper','H&W'),
  ('Non Shopper','H&W'),('Non Shopper','WomAE'),
  ('Active','MenA'),('Active','Westside'),
  ('Active Women','WomAW'),
  ('Push_WomenSeg1_06June25','WomAW'),
  ('Repeat_M4toM6_10July26','WomAW')
on conflict do nothing;

-- ---------- fixed daily time slots (the ~90 from the PN CC) ----------
create table if not exists fixed_time_slots (
  id serial primary key,
  slot_time time not null,
  slot_index int not null unique,
  is_standard boolean not null default true
);

truncate table fixed_time_slots restart identity cascade;

-- Insert the exact 90+ time slots from the PN CC structure
insert into fixed_time_slots (slot_time, slot_index) values
  ('07:30',1),
  ('08:00',2),('08:00',3),
  ('08:30',4),('08:30',5),('08:30',6),
  ('09:00',7),('09:00',8),('09:00',9),('09:00',10),
  ('09:30',11),('09:30',12),('09:30',13),
  ('10:00',14),('10:00',15),
  ('10:30',16),
  ('11:00',17),('11:00',18),
  ('11:30',19),
  ('12:00',20),('12:00',21),('12:00',22),
  ('12:30',23),('12:30',24),
  ('13:00',25),('13:00',26),('13:00',27),
  ('13:30',28),('13:30',29),('13:30',30),('13:30',31),
  ('14:00',32),('14:00',33),('14:00',34),
  ('14:30',35),('14:30',36),('14:30',37),
  ('15:00',38),('15:00',39),
  ('16:00',40),('16:00',41),
  ('16:30',42),('16:30',43),('16:30',44),('16:30',45),
  ('17:30',46),('17:30',47),('17:30',48),('17:30',49),
  ('18:30',50),
  ('19:00',51),('19:00',52),('19:00',53),('19:00',54),
  ('19:30',55),('19:30',56),('19:30',57),('19:30',58),
  ('20:00',59),
  ('20:30',60),('20:30',61),
  ('21:00',62),('21:00',63),('21:00',64),
  ('21:30',65),('21:30',66),('21:30',67),
  ('22:00',68),('22:00',69),
  ('22:30',70),('22:30',71),('22:30',72),
  ('23:00',73),('23:00',74),('23:00',75),
  ('23:30',76),('23:30',77),('23:30',78),('23:30',79),
  ('00:00',80),('00:00',81),
  ('00:30',82),('00:30',83),('00:30',84),
  ('01:00',85),('01:00',86),('01:00',87),('01:00',88),
  -- Extra tail slots from the PN CC
  ('23:30',89),('22:30',90),('21:00',91),('16:00',92);

-- ---------- add new columns to campaigns ----------
alter table campaigns add column if not exists pncc_segment_label text;
alter table campaigns add column if not exists pncc_segment_name text;
alter table campaigns add column if not exists pncc_category_code text;
alter table campaigns add column if not exists slot_type text not null default 'STANDARD';
alter table campaigns add column if not exists date_time_brief text;
alter table campaigns add column if not exists expected_cvr text;
alter table campaigns add column if not exists expected_rpv text;
alter table campaigns add column if not exists creative_requirements text;
alter table campaigns add column if not exists creative_link text;

-- ---------- RLS for new tables ----------
alter table pncc_segments    enable row level security;
alter table pncc_categories  enable row level security;
alter table approved_pairs   enable row level security;
alter table fixed_time_slots enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pncc_segments','pncc_categories','approved_pairs','fixed_time_slots']
  loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select to authenticated using (true)', t);
  end loop;
end $$;

-- ---------- validation function ----------
create or replace function public.validate_segment_category_pair(
  p_segment_label text,
  p_category_code text
) returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from approved_pairs
    where segment_label = p_segment_label
      and category_code = p_category_code
  );
$$;

grant execute on function public.validate_segment_category_pair(text, text) to authenticated;

select
  (select count(*) from pncc_segments) as segments,
  (select count(*) from pncc_categories) as categories,
  (select count(*) from approved_pairs) as pairs,
  (select count(*) from fixed_time_slots) as time_slots;
