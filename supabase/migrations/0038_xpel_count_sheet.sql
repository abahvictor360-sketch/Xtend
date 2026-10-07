-- =====================================================================
-- XTEND migration 038 — the Xpel stock count sheet
--
-- Stores are counted against Xpel's own stock count sheet: a fixed list of
-- products, each with its barcode, counted in the back store and on the
-- shop floor, with the expiry date of the stock on hand.
--
--   * products gain the barcode and their place on the sheet. Products on
--     the sheet are the list the phone shows; a product counted that is not
--     on the sheet is still created by name, as before (021).
--   * store_counts gain back_store, shop_floor and expiry_date. in_store
--     stays the total (back store + shop floor), so the totals, the
--     missing-stock check and the reports keep working on it.
--   * submit_store_count() takes either {back_store, shop_floor} or the
--     older {in_store} on each line, so a phone still on the old app can
--     send its count.
--   * A filled sheet may be sent back as the Excel file too (035).
-- =====================================================================

alter table public.products add column if not exists barcode text
  check (barcode is null or barcode ~ '^[0-9]{8,14}$');
alter table public.products add column if not exists sheet_order integer;

alter table public.store_counts add column if not exists back_store integer
  check (back_store is null or back_store between 0 and 1000000);
alter table public.store_counts add column if not exists shop_floor integer
  check (shop_floor is null or shop_floor between 0 and 1000000);
alter table public.store_counts add column if not exists expiry_date date
  check (expiry_date is null or expiry_date between date '2000-01-01' and date '2100-12-31');

-- ---------------------------------------------------------------------
-- The sheet, in its order. Running this again with a new list moves
-- products off the sheet rather than deleting them: their counts stay.
-- ---------------------------------------------------------------------
update public.products set sheet_order = null where sheet_order is not null;

insert into public.products (name, barcode, sheet_order) values
  ('Argan Oil Foot Treatment pack *24', '5060120164841', 1),
  ('Argan oil body butter (12''s)', '5060120165022', 2),
  ('Argan oil conditioner', '5060120164087', 3),
  ('Argan oil Facial wipes Twin Wipes 25X2', '5060120176332', 4),
  ('Argan oil hair masks 220ml (12''s)', '5060120164131', 5),
  ('Argan Oil Hair Treatment 100ml (12''S)', '5060120163714', 6),
  ('Argan Oil Hair Treatment 50ml (24''S)', '5060120164049', 7),
  ('Argan oil hand/nail lotion 100ml (12''s)', '5060120165176', 8),
  ('Argan oil heat defence leave in spray 150ml (12''s)', '5060120164346', 9),
  ('Argan Oil Moisturising Leave in Conditioner 250ml', '5060120176011', 10),
  ('Argan Oil Night Repair Serum 30ml', '5060120164551', 11),
  ('Argan Oil Night Repair Serum 50ml', '5060120164520', 12),
  ('Argan oil shampoo (12''s)', '5060120164063', 13),
  ('BIOTIN & COLLAGEN CONDITIONER 300ML TUBE NEW', '5060120176608', 14),
  ('Biotin & Collagen Conditioner 400ml (100ml extra free) *12', null, 15),
  ('BIOTIN & COLLAGEN SHAMPOO 300ML TUBE NEW', '5060120176585', 16),
  ('Charcoal Handwash Moisturising 500ml', null, 17),
  ('Coconut water Facial Twin Wipes', '5060120166746', 18),
  ('Coconut water foot packs *192', '5060120166616', 19),
  ('Coconut Water Hand & Nail Lotion 100ml *12', null, 20),
  ('Coconut Water Shower Creme 300ml', '5060120166449', 21),
  ('Dalton House hand wash Orchard Burst (Olive Green) 500ml *12', '5060120162977', 22),
  ('Dalton House hand wash Sea breeze (Blue) 500ml *12', '5060120162960', 23),
  ('Dalton House hand wash Sweet Rose (Crimson) 500ml *12', '5060120162984', 24),
  ('Dr Magic Double Action Foamer 500ml *12', '5060120160812', 25),
  ('Dr Magic OVEN & Grill Cleaner 390ml', '5060120161789', 26),
  ('Dr Magic Snatch A Dye Colour Catcher *12', '5060120161024', 27),
  ('Fresh Start Coconut & Lime Showeer Gel 400ml *12', '5060120163318', 28),
  ('Fresh Start Mint & Cucumber Shower Gel 150ml', null, 29),
  ('Fresh Start Mint & Cucumber shower Gel 400ml *12', '5060120163325', 30),
  ('Fresh start Tea Tree & Lemon Shower Gel 400ml *12', '5060120163301', 31),
  ('HOT ROSE 5% AHA SERENA SERUM DEO - BLUE SHELL 50ML X24', '5061015259901', 32),
  ('HOT ROSE 5% AHA SERENA SERUM DEO - FIRST BLOOM 50ML X24', '5061015259895', 33),
  ('HOT ROSE 5% AHA SERENA SERUM DEO -TROPICAL GREENS 50ML X24', '5061015259925', 34),
  ('HOT ROSE 5% AHA SERENA SERUM DEO -TWILIGHT DREAM 50ML X24', '5061015259918', 35),
  ('HOT ROSE FIXT DEWY SETTING SPRAY - LYCHEE + DAMASK ROSE HYDROSOL 80ML X12', '5061015258355', 36),
  ('HYGIE ADVANCED PROTECTION ALOE VERA HANDWASH 500ML X12', '5061015257327', 37),
  ('HYGIE ADVANCED PROTECTION CITRU HANDWASH 500ML X12', '5061015257334', 38),
  ('HYGIE ADVANCED PROTECTION ORIGINAL HANDWASH 500ML X12', '5061015257310', 39),
  ('INTIMELLE ALOE VERA DAILY FEMININE WASH 250ML X12', '5061015256412', 40),
  ('Keratin Classic Conditioner 400ml *12', '5060120176561', 41),
  ('Keratin Classic Shampoo 400ml *12', '5060120176547', 42),
  ('LPC HOT ROSE FIXT MATTE SETTING SPRAY - VETIVER ROOT + SQUALANE 80ML X12', '5061015258362', 43),
  ('LPC HOT ROSE FIXT VIT C SETTING SPRAY -TUSCAN CYPRSS + MANDARIN 80ML X12', '5061015258379', 44),
  ('LPC HOT ROSE LIP BUTTER (MIX) 4 FRAGRANCES X6', '5061015257426', 45),
  ('LPC HOT ROSE MIXT DUO MAKEUP REMOVER CUCUMBER +WILD MINT 150ML X12', '5061015259253', 46),
  ('LPC HOT ROSE MIXT DUO MAKEUP REMOVER LYCHE + ROSEWATER 150ML X12', '5061015259239', 47),
  ('LPC HOT ROSE MIXT DUO MAKEUP REMOVER NEROLI + MANDARIN 150ML X12', '5061015259246', 48),
  ('LPC HOT ROSE SKIN CAPSULE SERUM - HYALURONIC ACID 50ML X24', '5061015259840', 49),
  ('LPC HOT ROSE SKIN CAPSULE SERUM - VITAMIN C GLOW X24', '5061015259833', 50),
  ('LPC HOT ROSE SKIN CAPSULE SERUM- NIACINAMIDE CLARIFYING 50ML X24', '5061015259864', 51),
  ('LPC HOT ROSE SKIN CAPSULE SERUM- VITAMIN E ANTIOXIDANT 50ML X24', '5061015259857', 52),
  ('Macadamia Oil Conditioner 400ml (Extra Fill) *12', '5060120165879', 53),
  ('Macadamia Oil Hair Mask 250ml *12', '5060120164742', 54),
  ('Macadamia Oil Shampoo 400ml (Extra Fill) *12', '5060120165862', 55),
  ('Medex Anti-bac Creme Handwash Original Extra Fill 650ml *12', null, 56),
  ('Medex Anti-bac Handwash Aloe Vera Extra Fill 650ml *12', '5060120160256', 57),
  ('Medex Antibacterial Handwash Aloe Vera 650ml Refill Flip Cap', '5060120172495', 58),
  ('Medex Antibacterial Handwash Moisturising 650ml Refill Flip Cap', '5060120172471', 59),
  ('Medex Minty Fresh Breath Spray 20ml (72'') * 18 By 4', '5060120162564', 60),
  ('Mediguard disinfectant 1 ltr * 12', '5060120160935', 61),
  ('Medipure Powder', '5060120163219', 62),
  ('medipure Hair & Scalp - Hair Treatment for Dry Scalp 150ml', '5060120175618', 63),
  ('Medipure Hair & Scalp 2 in 1 Anti-Dand Shampoo 400ml *12', '5060120163943', 64),
  ('Medipure Hair & Scalp Hydrating Conditioner 400ml', '5060120175526', 65),
  ('Medipure Hair & Scalp Hydrating Hair Mask for Dry Scalp 250ml', '5060120175557', 66),
  ('Medipure Hair & Scalp Hydrating Shampoo 400ml', '5060120175465', 67),
  ('Medipure Hair & Scalp Orig Anti-Dand Shampoo 400ml *12', '5060120161277', 68),
  ('Mucky Pups Flea Repellent Dog Shampoo *12', '5060120162892', 69),
  ('NULAB 48 HRS FEELING BLISS ANTI-PERSPIRANT WOMEN ROLL-ON -POMEGRANATE & LOTUS-50ML X24', '5061015255804', 70),
  ('NULAB 48 HRS FEELING BLISS ANTI-PERSPIRANT WOMEN STICK -POMEGRANATE & LOTUS -64G X24', '5061015253640', 71),
  ('NULAB 48 HRS FEELING FRESH ANTI-PERSPIRANT WOMEN ROLL-ON -CUCUMBER & JASMINE -50ML X24', '5061015255798', 72),
  ('NULAB 48 HRS FEELING FRESH ANTI-PERSPIRANT WOMEN STICK -CUCUMBER & JASMINE -64G X24', '5061015253633', 73),
  ('NULAB 48 HRS FEELING ZESTY ANTI-PERSPIRANT WOMEN ROLL-ON -GRAPEFRUIT & LEMOM -50ML X24', '5061015255811', 74),
  ('NULAB 48 HRS FEELING ZESTY ANTI-PERSPIRANT WOMEN STICK -GRAPEFRUIT & LEMOM -64G X24', '5061015253657', 75),
  ('NULAB COCOA GLOW BODY GEL OIL 500ML X12', null, 76),
  ('NULAB COCONUT RENEW BODY GEL OIL 500ML X12', null, 77),
  ('NULAB DREAMLIFT FIRMING ANTI-WRINKLE FACE DAY CREAM 50ML X24', '5061015256801', 78),
  ('NULAB DREAMLIFT FIRMING ANTI-WRINKLE FACE NIGHT CREAM 50MLX24', '5061015256818', 79),
  ('NULAB FEELING BLISS WOMEN MIST DEO SPRAY - POMEGRANATE & LOTUS 150ML X12', '5061015256368', 80),
  ('NULAB FEELING FRESH WOMEN MIST DEO SPRAY - CUCUMBER &JASMINE 150ML X12', '5061015256351', 81),
  ('NULAB FEELING SILKY SKIN DRENCHING MOIST. CREAM TUBE 200ML X12', '5061015255576', 82),
  ('NULAB FEELING SILKY SKIN DRENCHING MOIST. CREAM CUP 300ML X12', '5061015255606', 83),
  ('NULAB FEELING ZESTY WOMEN MIST DEO SPRAY - GRAPEFRUIT & LEMON150ML X12', '5061015256375', 84),
  ('NULAB MEN PROTECT 48HRS ANTI-SWEAT ROLL-ON - ADVENTURE 50ML X24', '5061015255835', 85),
  ('NULAB MEN PROTECT 48HRS ANTI-SWEAT ROLL-ON - SPORT COOL 50ML X24', '5061015255828', 86),
  ('NULAB MEN PROTECT 48HRS ANTI-SWEAT ROLL-ON- EXTREME DRY 50ML X24', '5061015255842', 87),
  ('NULAB MEN PROTECT 48HRS ANTI-SWEAT STICK - ADVENTURE 64G X24', '5061015253671', 88),
  ('NULAB MEN PROTECT 48HRS ANTI-SWEAT STICK - EXTREME DRY 64G X24', '5061015253688', 89),
  ('NULAB MEN PROTECT 48HRS ANTI-SWEAT STICK - SPORT COOL 64G X24', '5061015253664', 90),
  ('NULAB Q1O RADIANCE DAY CREAM - FIRMING & ANTI-AGEING 50ML X24', '5061015256764', 91),
  ('NULAB Q1O RADIANCE NIGHT CREAM - FIRMING & ANTI-AGEING 50ML X24', '5061015256771', 92),
  ('NULAB WHOLE BODY CREAM - COCOA BUTTER 500ML X 12', '5061015257532', 93),
  ('NULAB WHOLE BODY CREAM - OLIVE OIL 500ML X 12', '5061015257563', 94),
  ('NULAB WHOLE BODY CREAM - VITAMIN C 500ML X 12', '5061015257556', 95),
  ('NULAB WHOLE BODY CREAM - VITAMIN E 500ML X 12', '5061015257549', 96),
  ('Osiris Recovery Oil 100ml *12', '5060120163141', 97),
  ('Tea Tree Body Scrub Cup 300ml', '5060120175991', 98),
  ('Tea Tree & Peppermint Deep Moisturizing Foot Treatment *192', '5060120163530', 99),
  ('Tea Tree & Peppermint Deep Moisturizing Hand Treatment *192', '5060120163547', 100),
  ('Tea Tree Antibacterial Handwash 500ml *12', '5060120163257', 101),
  ('Tea Tree Body Butter 250ml', '5060120173591', 102),
  ('Tea Tree Cleansing Facial Scrub 250ml *12', '5060120163363', 103),
  ('Tea Tree Cleansing Facial Twin Wipes', '5060120163387', 104),
  ('Tea Tree Cleansing Pad 60sheets', '5060120171467', 105),
  ('Tea Tree Conditioner Bottle 400ml *12', '5060120166432', 106),
  ('Tea Tree Facial Toner 200ml', '5060120174468', 107),
  ('Tea Tree Foaming Face Wash 200ml *12', '5060120163424', 108),
  ('TEA TREE MOIST. FACE MASK', '5060120179630', 109),
  ('Tea Tree Oil 10ml *12 By 8', '5060120168757', 110),
  ('Tea Tree Oil 30ml *12 By 4', '5060120168764', 111),
  ('Tea Tree Shampoo Bottle 400ml *12', '5060120166425', 112),
  ('TRUESIMILE SENSIO ENAMEL RESTORE TOOTHPASTE 75ML X48', '5061015255972', 113),
  ('TRUESIMILE SENSIO GENTLE WHITENING TOOTHPASTE 75ML X48', '5061015256009', 114),
  ('TRUESIMILE SENSIO INSTANT RELIEF TOOTHPASTE 75ML X48', '5061015255989', 115),
  ('TRUESIMILE SENSIO SENSITIVITY+ GUM TOOTHPASTE TWIN PACK X24', '5061015255996', 116),
  ('TRUESMILE PROWHITE TOOTHPASTE WITH TOOTHBRUSH 100ML X12', '5061015250564', 117),
  ('TRUESMILE BAKING SODA WHITENING TOOTHPASTE WITH TOOTHBRUSH 100ML X12', '5061015256953', 118),
  ('TRUESMILE CHARCOAL TOOTHPASTE WITH TOOTHBRUSH 100ML X12', '5061015256953', 119),
  ('TRUESMILE MONSTER KIDS BUBBLE GUM TOOTHPASTE X12', '5061015253732', 120),
  ('TRUESMILE MONSTER KIDS STRAWBERRY TOOTHPASTE X12', '5061015253749', 121),
  ('TRUESMILE PROCARE TOOTHPASTE WITH TOOTHBRUSH 100ML X12', '5061015250571', 122),
  ('TRUESMILE PROCLEAN TOOTHPASTE WITH TOOTHBRUSH 100ML X12', '5061015250557', 123),
  ('TRUESMILE PROFRESH TOOTHPASTE WITH TOOTHBRUSH 100ML X12', '5061015250540', 124),
  ('TRUESMILE PRO-PURPLE TOOTHPASTE WITH TOOTHBRUSH 100ML X12', '5061015256977', 125),
  ('TRUESMILE TARTAR DEFENCE TOOTHPASTE WITH TOOTHBRUSH 100ML X12', '5061015257068', 126),
  ('TRUESMILE TRIPLE PROTECT TOOTHPASTE WITH TOOTHBRUSH 100ML X12', '5061015256955', 127),
  ('Ultrex Panty liner *24', '5060110224951', 128),
  ('XBC Aloe Body Wash 250ml', '5060120170859', 129),
  ('XBC Aloe Vera Cleansing Facial Wipes Twin Pack 25X2', '5060120176356', 130),
  ('XBC Aloe Vera Cooling Gel 250ml', '5060120170873', 131),
  ('XBC Aloe Vera Cream 500ml *12', '5060120167033', 132),
  ('XBC ALOE VERA FACE & BODY SCRUB 250ML', '5060120175694', 133),
  ('XBC Aloe Vera Face & Body Scrub Cup 300ml', null, 134),
  ('XBC ALOE VERA HYDRATING FACE TONER 200ML', '5060120175670', 135),
  ('XBC ALOE VERA NOURISHING FACE MASK', '5060120178732', 136),
  ('XBC Aloe Vera Refreshing Foaming Face wash 250ml', '5060120175953', 137),
  ('XBC Aqueous cream 500ml *12', '5060120166517', 138),
  ('XBC Banana Body Wash 400ml', null, 139),
  ('XBC Banana Body Yogurt 250ml', '5060120170576', 140),
  ('XBC BANANA FACE &BODY SCRUB 250ML', '5060120175717', 141),
  ('XBC Charcoal Cleansing Conditioner 400ml *12', null, 142),
  ('XBC Charcoal Detox Facial Mask *24', '5060120167804', 143),
  ('XBC Charcoal Facial Scrub 250ml *12', '5060120167606', 144),
  ('XBC Cocoa Butter Cream 500 ml *12', '5060120167026', 145),
  ('XBC Eco Friendly Bamboo Cotton buds *300', '5060120171368', 146),
  ('XBC Hemp Body Lotion 250ml', '5060120170231', 147),
  ('XBC Hemp Face Mask *24', '5060120170705', 148),
  ('XBC Hemp Hand Cream 100ml', '5060120170248', 149),
  ('XBC NEEM OIL EXFOLIATING FOAMING FACE WASH 200ML X12', '5060120180193', 150),
  ('XBC NEEM OIL FACIAL SCRUB 300ML X12', '5060120180179', 151),
  ('XBC Olive Oil Cream', '5060120167040', 152),
  ('XBC Papaya Cleansing Face Wash 250ml', '5060120175977', 153),
  ('XBC PAPAYA FACE & BODY SCRUB 250ML', '5060120175731', 154),
  ('XBC PAPAYA HYDRATING FACE MASK', '5060120178701', 155),
  ('XBC PAPAYA PORE REFINING FACE TONER 200ML', '5060120175656', 156),
  ('XBC Purifying Charcoal cleansing Facial Twin Wipes', '5060120176370', 157),
  ('XBC SLS Free Aqueous cream 500ml *12', '5060120167002', 158),
  ('XBC so fresh watermelon crush facial cleanser', '5060120176806', 159),
  ('XBC So Fresh Watermelon Crush Facial Scrub', '5060120176820', 160),
  ('XBC so fresh watermelon crush pore-tight toner', '5060120176844', 161),
  ('XBC SO FRESH WATERMELON FACEMASK', '5060120176882', 162),
  ('XBC Strawberry Body Yogurt 200ml', '5060120170583', 163),
  ('XBC VITAMIN C FACE SERUM 30ML', '5060120178862', 164),
  ('XBC VITAMIN C FACIAL SCRUB 250ML TUBE', '5060120178824', 165),
  ('XBC VITAMIN C FOAMING FACE WASH 200ML', '5060120178886', 166),
  ('XBC VITAMIN C REVITALISING FACE MASK', '5060120178671', 167),
  ('XBC Vitamin C Revitalizing Facial Wipes Twin Pack', '5060120175434', 168),
  ('XBC VITAMIN C SALT BODY SCRUB 300G', '5060120178848', 169),
  ('XBC Vitamin E Cream', '5060120167279', 170),
  ('XFC ODOUR CONTROL FOOT SPRAY 150ML', '5060120176646', 171),
  ('XFC SHOE REFRESHER SPRAY 150ML', '5060120176660', 172),
  ('XHC Aloe Vera Conditioner 250ml', '5060120170835', 173),
  ('XHC ALOE VERA HEAT DEFENCE SPRAY 150ML', '5060120177513', 174),
  ('XHC ALOE VERA NOURISHING LEAVE-IN CONDITIONER 250ML', '5060120178787', 175),
  ('XHC Aloe Vera Shampoo 250ml', '5060120170811', 176),
  ('XHC AVOCADO & ALMOND HEAT DEFENCE SPRAY 150ML', '5060120177551', 177),
  ('XHC Banana Conditioner', '5060120169310', 178),
  ('XHC Banana shampoo', '5060120169303', 179),
  ('XHC BIOTIN & COLLAGEN HAIR MASK 220ML', '5060120175632', 180),
  ('XHC BLACK CASTOR OIL & AVOCADO HAIR & SCALP TREATEMNT 150ML', '5060120179449', 181),
  ('XHC BLACK CASTOR OIL & AVOCADO HEAT DEFENCE SPRAY 150ML', '5060120177537', 182),
  ('XHC BLACK CASTOR OIL & AVOCADO LEAVE-IN CONDITIONER 250ML', '5060120179425', 183),
  ('XHC BLACK CASTOR OIL & AVOCADO SHAMPOO 400ML', '5060120179401', 184),
  ('XHC Botanical Aloe Vera Vegan Conditioner 300ml', '5060120176158', 185),
  ('XHC Botanical Aloe Vera Vegan Hair Serum 100ml', '5060120176196', 186),
  ('XHC Botanical Aloe Vera Vegan Shampoo 400ml', '5060120179401', 187),
  ('XHC Botanical Moistursing Vegan Hair Mask 300ml', '5060120176172', 188),
  ('XHC Coconut Hydrating Conditioner 400ml', '5060120174369', 189),
  ('XHC COCONUT HYDRATING HAIR MASK 250ML', '5060120174383', 190),
  ('XHC Coconut Hydrating Shampoo 400ml', '5060120174345', 191),
  ('XHC Ginger Anti-Dandruff Shampoo 400ml', '5060120169280', 192),
  ('XHC Ginger Conditioner 400ml', '5060120169297', 193),
  ('XHC Green Tea Conditioner 400ml', '5060120170064', 194),
  ('XHC Green Tea Shampoo 400ml', '5060120170057', 195),
  ('XHC Hemp Conditioner 400ml', '5060120170224', 196),
  ('XHC Hemp Hair Mask 220ml', null, 197),
  ('XHC Hemp Shampoo 400ml', '5060120170217', 198),
  ('XHC KERATIN CLASSIC SHAMPOO 300ML TUBE', '5060120176547', 199),
  ('XHC KERATIN CLASSIC CONDITIONER 300ML TUBE', '5060120176561', 200),
  ('XHC ROSEMARY & MINT HAIR CONDITIONER 300ML', '5060120177865', 201),
  ('XHC ROSEMARY & MINT HAIR OIL 60ML', '5060120177452', 202),
  ('XHC ROSEMARY & MINT HAIR SHAMPOO 300ML', '5060120177841', 203),
  ('XHC ROSEMARY & MINT NOURISHING LEAVE IN CONDITIONER 250ML', '5060120178800', 204),
  ('XHC Strawberry Conditioner 400ml', '5060120170040', 205),
  ('XHC Strawberry Shampoo 400ml', '5060120170033', 206),
  ('XNC 150ml nail & tip remover *12', '5060120166807', 207),
  ('XNC Nail Polish Remover - Acetone free 250ml', '5060120166784', 208),
  ('XNC Nail Polish Remover 150ml (12)', '5060120173287', 209),
  ('XNC Pump it Up Nail Polish Remover GEL', '5060120166951', 210),
  ('XNC Quick n Easy Nail Polish Removing Sponge Acetone free', '5060120167897', 211),
  ('XOC Charcoal Cleansing Toothpaste *48', '5060120168115', 212),
  ('XOC Charcoal Cleansing Toothpaste with Toothbrush *48', '5060120168115', 213),
  ('XOC Charcoal Mouthwash 500ml *12', '5060120168214', 214),
  ('XOC DUAL ACTION CLOVE MOUTHWASH 500ML', '5060120177353', 215),
  ('XOC DUAL ACTION MINT MOUTHWASH 500ML', '5060120177339', 216),
  ('XOC Hemp Mouthwash 500ml', '5060120171009', 217),
  ('XOC HEMP TOOTHPASTE WITH TOOTHBRUSH 100ML', '5060120170736', 218),
  ('XOC Medex Twin Mouthwash/Whitener 500ml *12', '5060120161741', 219),
  ('XOC NEEMO OIL & MINT TOOTHPASTE WITH TOOTHBRUSH 100ML X48', '5060120180056', 220),
  ('Xoc Purple Polishing Tooth Powder 30g X36', '5060120177780', 221),
  ('XOC PURPLE WHITENING MOUTHWASH 500ML', '5060120177742', 222),
  ('XOC PURPLE WHITENING TOOTHPASTE WITH TOOTHBRUSH', '5060120177292', 223),
  ('XOC TEA TREE FRESH BREATH TOOTHPASTE WITH TOOTHBRUSH *48', '5060120176295', 224),
  ('XOC Tea Tree Mouthwash 500ml', '5060120177575', 225),
  ('Xpel Bug Cooling Aerosol 100ml', '5060120160591', 226),
  ('Xpel Bug Cooling Pump Spray 120ml *12', '5060120160652', 227),
  ('Xpel Bug Cooling Pump Spray 70ml *12', '5060120163851', 228),
  ('Xpel kids mosquito Repellent Pump Spray 70ml', '5060120163868', 229),
  ('Xpel Kids Mosquitoes Repellant Wrist Band', null, 230),
  ('Xpel Mosquito Repellent Aerosol 100ml', null, 231),
  ('Xpel Mosquito repellent Pump Spray 120ml *12', '5060120160645', 232),
  ('Xpel Mosquito repellent Pump Spray 70ml *12', '5060120163844', 233)
on conflict ((lower(btrim(name)))) do update
  set barcode = excluded.barcode, sheet_order = excluded.sheet_order, is_active = true;

-- ---------------------------------------------------------------------
-- Store counts, back store and shop floor.
-- ---------------------------------------------------------------------
create or replace function public.submit_store_count(
  p_outlet_id uuid,
  p_lines jsonb,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_photo_path text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  today date := public.business_date();
  status jsonb := public.store_count_status();
  req uuid := nullif(status->>'request_id', '')::uuid;
  store record;
  dist double precision;
  saved integer;
  missing jsonb;
  lines jsonb;
begin
  if not public.can_count_stock() then
    raise exception 'You cannot submit a store count';
  end if;
  if not coalesce((status->>'open')::boolean, false) then
    raise exception 'No store count is due: counts are taken when a supervisor asks, or at the end of the month';
  end if;
  if p_outlet_id is null
     or p_outlet_id not in (select outlet_id from public.outlets_for_user(auth.uid())) then
    raise exception 'That store is not one of yours';
  end if;

  -- A. In the store, now.
  select o.lat, o.lng, o.geofence_radius_m into store from public.outlets o where o.id = p_outlet_id;
  if p_lat is null or p_lng is null or p_accuracy_m is null or p_accuracy_m > 100 then
    raise exception 'Your location is not accurate enough. Step near a window and try again';
  end if;
  -- A store waiting for its location cannot say whether anyone is in it.
  if store.lat is null or store.lng is null then
    raise exception 'This store''s location is still being confirmed. Ask your supervisor, then count it once it is confirmed';
  end if;
  dist := public.distance_metres(p_lat, p_lng, store.lat, store.lng);
  if dist > store.geofence_radius_m + 25 then
    raise exception 'You must be in the store to submit its count (you are % m away)', round(dist::numeric);
  end if;
  if p_photo_path is null or not public.photo_is_fresh('reports', p_photo_path, 30) then
    raise exception 'Take the shelf photo in the app just before submitting';
  end if;
  if exists (select 1 from public.store_counts c
             where c.photo_path = p_photo_path
               and not (c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date = today)) then
    raise exception 'That shelf photo has already been used';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Count at least one product';
  end if;
  if jsonb_array_length(p_lines) > 500 then
    raise exception 'Too many products in one count';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
             where length(public.product_key(l->>'product_name')) not between 1 and 120) then
    raise exception 'Every product needs a name of up to 120 characters';
  end if;

  -- Every figure a line carries is a whole number from 0 up. A line has
  -- back store and shop floor (the sheet), or in_store (older phones).
  if exists (
    select 1 from jsonb_array_elements(p_lines) l,
         lateral (values ('back_store'), ('shop_floor'), ('in_store'), ('sold')) f(k)
    where l ? f.k and jsonb_typeof(l->f.k) <> 'null'
      and (jsonb_typeof(l->f.k) <> 'number'
           or (l->>f.k)::numeric <> trunc((l->>f.k)::numeric)
           or (l->>f.k)::numeric not between 0 and 1000000)
  ) or exists (
    select 1 from jsonb_array_elements(p_lines) l
    where coalesce(jsonb_typeof(l->'back_store'), 'null') = 'null'
      and coalesce(jsonb_typeof(l->'shop_floor'), 'null') = 'null'
      and coalesce(jsonb_typeof(l->'in_store'), 'null') = 'null'
  ) then
    raise exception 'Counts must be whole numbers from 0 up';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where coalesce(jsonb_typeof(l->'expiry_date'), 'null') <> 'null'
      and (jsonb_typeof(l->'expiry_date') <> 'string'
           or l->>'expiry_date' !~ '^\d{4}-\d{2}-\d{2}$'
           or not (l->>'expiry_date' between '2000-01-01' and '2100-12-31'))
  ) then
    raise exception 'Expiry dates must be real dates';
  end if;
  if (select count(distinct public.product_key(l->>'product_name')) from jsonb_array_elements(p_lines) l)
     <> jsonb_array_length(p_lines) then
    raise exception 'A product appears twice in the count';
  end if;

  -- One shape from here on: in_store is the total in the store.
  select jsonb_agg(jsonb_build_object(
           'product_name', l->>'product_name',
           'back_store', b.back_store,
           'shop_floor', b.shop_floor,
           'in_store', case when b.back_store is null and b.shop_floor is null
                            then (l->>'in_store')::integer
                            else coalesce(b.back_store, 0) + coalesce(b.shop_floor, 0) end,
           'sold', coalesce((nullif(l->>'sold', ''))::integer, 0),
           'expiry_date', nullif(l->>'expiry_date', '')))
    into lines
  from jsonb_array_elements(p_lines) l,
       lateral (select (nullif(l->>'back_store', ''))::integer as back_store,
                       (nullif(l->>'shop_floor', ''))::integer as shop_floor) b;

  insert into public.products (name)
  select distinct on (public.product_key(l->>'product_name'))
         regexp_replace(btrim(l->>'product_name'), '\s+', ' ', 'g')
  from jsonb_array_elements(lines) l
  where not exists (select 1 from public.products p
                    where public.product_key(p.name) = public.product_key(l->>'product_name'))
  on conflict do nothing;

  insert into public.store_counts
    (user_id, outlet_id, product_id, count_date, in_store, sold, request_id,
     lat, lng, accuracy_m, distance_m, photo_path, back_store, shop_floor, expiry_date)
  select auth.uid(), p_outlet_id,
         (select p.id from public.products p
          where public.product_key(p.name) = public.product_key(l->>'product_name')
          order by p.created_at limit 1),
         today, (l->>'in_store')::integer, (l->>'sold')::integer, req,
         p_lat, p_lng, p_accuracy_m, dist, p_photo_path,
         (l->>'back_store')::integer, (l->>'shop_floor')::integer, (l->>'expiry_date')::date
  from jsonb_array_elements(lines) l
  on conflict (user_id, outlet_id, product_id, count_date)
  do update set in_store = excluded.in_store, sold = excluded.sold,
                back_store = excluded.back_store, shop_floor = excluded.shop_floor,
                expiry_date = excluded.expiry_date,
                request_id = excluded.request_id, lat = excluded.lat, lng = excluded.lng,
                accuracy_m = excluded.accuracy_m, distance_m = excluded.distance_m,
                photo_path = excluded.photo_path, updated_at = now();
  get diagnostics saved = row_count;

  -- B. Does it add up? Compared with this person's previous count at this store.
  -- A correction later the same day replaces today's flags rather than adding more.
  delete from public.integrity_flags
  where user_id = auth.uid() and outlet_id = p_outlet_id and flag_date = today
    and kind like 'count_%' and reviewed_at is null;

  with cur as (
    select c.product_id, c.in_store, c.sold from public.store_counts c
    where c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date = today
  ), prev as (
    select distinct on (c.product_id) c.product_id, c.in_store, c.sold
    from public.store_counts c
    where c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date < today
    order by c.product_id, c.count_date desc
  )
  select jsonb_agg(jsonb_build_object(
           'product', pr.name, 'last_left', prev.in_store, 'sold', cur.sold,
           'expected_left', prev.in_store - cur.sold, 'left', cur.in_store,
           'missing', prev.in_store - cur.sold - cur.in_store))
    into missing
  from cur join prev using (product_id) join public.products pr on pr.id = cur.product_id
  -- Fewer units than last time minus what was sold: stock went somewhere.
  -- More is fine: that is a delivery.
  where prev.in_store - cur.sold - cur.in_store > greatest(2, 0.1 * prev.in_store);

  if missing is not null then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id)
    values (auth.uid(), 'count_units_missing', 'high',
            format('%s product(s) have fewer units left than the last count minus sales',
                   jsonb_array_length(missing)),
            jsonb_build_object('products', missing), p_outlet_id);
  end if;

  if (select count(*) from public.store_counts c
      where c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date = today) >= 2
     and not exists (
       select 1 from public.store_counts cur
       where cur.user_id = auth.uid() and cur.outlet_id = p_outlet_id and cur.count_date = today
         and not exists (
           select 1 from public.store_counts prev
           where prev.user_id = cur.user_id and prev.outlet_id = cur.outlet_id
             and prev.product_id = cur.product_id and prev.in_store = cur.in_store
             and prev.sold = cur.sold
             and prev.count_date = (select max(p2.count_date) from public.store_counts p2
                                    where p2.user_id = cur.user_id and p2.outlet_id = cur.outlet_id
                                      and p2.count_date < today)))
  then
    insert into public.integrity_flags (user_id, kind, severity, summary, outlet_id)
    values (auth.uid(), 'count_identical', 'medium',
            'Every number is exactly the same as the previous count', p_outlet_id);
  end if;

  if (select count(*) from public.store_counts c
      where c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date = today) >= 4
     and not exists (
       select 1 from public.store_counts c
       where c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date = today
         and (c.in_store % 10 <> 0 or c.sold % 10 <> 0))
     and exists (
       select 1 from public.store_counts c
       where c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date = today
         and (c.in_store > 0 or c.sold > 0))
  then
    insert into public.integrity_flags (user_id, kind, severity, summary, outlet_id)
    values (auth.uid(), 'count_round_numbers', 'low',
            'Every number in the count is a multiple of 10', p_outlet_id);
  end if;

  return saved;
end;
$$;

revoke all on function public.submit_store_count(uuid, jsonb, double precision, double precision, double precision, text) from public, anon;
grant execute on function public.submit_store_count(uuid, jsonb, double precision, double precision, double precision, text) to authenticated, service_role;

-- The count view gains the sheet's columns, after the ones it had.
create or replace view public.store_count_detail
with (security_invoker = true) as
  select c.id, c.count_date, c.user_id, p.full_name as staff_name, c.outlet_id,
         o.name as outlet_name, c.product_id, pr.name as product_name, pr.sku,
         c.in_store, c.sold, c.updated_at, c.distance_m, c.accuracy_m, c.photo_path,
         pr.barcode, c.back_store, c.shop_floor, c.expiry_date
  from public.store_counts c
  join public.profiles p  on p.id = c.user_id
  join public.outlets o   on o.id = c.outlet_id
  join public.products pr on pr.id = c.product_id;

grant select on public.store_count_detail to authenticated;

-- ---------------------------------------------------------------------
-- A filled sheet can come back as the Excel file it was downloaded as.
-- ---------------------------------------------------------------------
create or replace function public.submit_count_sheet(
  p_outlet_id uuid,
  p_path text,
  p_file_name text
) returns uuid
language plpgsql security definer set search_path = public, storage as $$
declare
  status jsonb := public.store_count_status();
  obj record;
  kind text;
  clean_name text := left(btrim(regexp_replace(coalesce(p_file_name, ''), '[\r\n\t/\\]+', ' ', 'g')), 200);
  new_id uuid;
begin
  if not public.can_count_stock() then
    raise exception 'You cannot submit a store count';
  end if;
  if not coalesce((status->>'open')::boolean, false) then
    raise exception 'No store count is due: counts are taken when a supervisor asks, or at the end of the month';
  end if;
  if p_outlet_id is null
     or p_outlet_id not in (select outlet_id from public.outlets_for_user(auth.uid())) then
    raise exception 'That store is not one of yours';
  end if;

  -- Uploaded into their own folder in the last 30 minutes. (Not
  -- photo_is_fresh(): that also wants a photo check, which a PDF never has.)
  select o.metadata->>'mimetype' as mimetype, (o.metadata->>'size')::bigint as size
    into obj
  from storage.objects o
  where o.bucket_id = 'reports'
    and o.name = p_path
    and p_path like auth.uid()::text || '/%'
    and o.created_at >= now() - interval '30 minutes';
  if not found then
    raise exception 'Upload the filled count sheet again, then send it';
  end if;
  if exists (select 1 from public.store_count_sheets s where s.path = p_path) then
    raise exception 'That file has already been sent';
  end if;

  kind := lower(coalesce(obj.mimetype, ''));
  if kind not in ('application/pdf', 'image/jpeg', 'image/png',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then
    raise exception 'Send the count sheet as the Excel file, a PDF, or a photo of it (JPG or PNG)';
  end if;
  if coalesce(obj.size, 0) <= 0 or obj.size > 10 * 1024 * 1024 then
    raise exception 'The count sheet must be smaller than 10 MB';
  end if;

  insert into public.store_count_sheets
    (user_id, outlet_id, count_date, request_id, path, file_name, content_type, size_bytes)
  values
    (auth.uid(), p_outlet_id, public.business_date(),
     nullif(status->>'request_id', '')::uuid, p_path,
     coalesce(nullif(clean_name, ''), 'Count sheet'), kind, obj.size)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.submit_count_sheet(uuid, text, text) from public, anon;
grant execute on function public.submit_count_sheet(uuid, text, text) to authenticated, service_role;

select 'Xpel stock count sheet (038) installed' as result;
