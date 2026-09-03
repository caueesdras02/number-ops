begin;

-- Idempotent, additive-only: inserts ONLY clients from the approved real list that do not
-- already exist (case-insensitive, trim-insensitive match). Never updates or removes existing
-- rows, never touches squad_id of existing clients, safe to run multiple times.
insert into public.clients (id, name, is_active, created_at, updated_at)
select 'client_' || gen_random_uuid()::text, v.name, true, now(), now()
from (values
  ('3BKASA'),('Agiani'),('Allenza'),('Ariane'),('Atacadão da Economia'),('Aura Radiante'),
  ('AVOZON'),('BDG'),('BELISSIMA ATACADISTA'),('Boa Vista Pisos'),('CajuBrasil'),('Carol Lucio'),
  ('Casa Pommern'),('CK SEMIJOIAS'),('Construpiso'),('Criss Mazzer'),('Divina Flor'),('Dr Cherie'),
  ('DuoLink'),('EJX SOLAR'),('Elemento Sete'),('emporio real'),('Entre Joias'),('Fabi Gomes Semijoias'),
  ('Faca Castel'),('Fernanda Mion'),('HS Moda'),('Julia Liziê'),('Laleska'),('Lanza Imports'),
  ('Loja Transito'),('Lojao da Ilha'),('LOJÃO DA IVANIR'),('Lojas Tropical'),('Lucy semijoias'),
  ('Magnifica Joias'),('Marggoh'),('Maria Petilo'),('Matracon'),('Mazzeto'),('Memê Store'),
  ('Nacarati'),('New Man'),('Nutriage Suplementos'),('NY Joias'),('PANDA'),('PAPELOU'),('PAZSOS'),
  ('PERFECT'),('Perfumaria SP'),('Premocil'),('Pura Beleza'),('QUEIROZ'),('Rede Torra tudo'),
  ('Sônia Falcão'),('Sottile'),('Star Joias'),('Superkasa'),('Tania semijoias'),('Thah Rezende'),
  ('Trizga'),('Uai'),('UNIVERSO DOS ENXOVAIS'),('Varejão Colchões'),('Via Flora'),('VILLA VOGUE'),
  ('Viviane Manfrim'),('Zaffari')
) as v(name)
where not exists (
  select 1 from public.clients c where lower(btrim(c.name)) = lower(btrim(v.name))
);

commit;
