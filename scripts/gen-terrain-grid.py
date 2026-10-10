#!/usr/bin/env python3
"""
Classe automatiquement le terrain de chaque hex de la carte Arnhem (39x26 =
1014 hexs) par échantillonnage de couleur, à partir des références visuelles
relevées sur la carte, puis injecte le résultat dans public/modules/arnhem/arnhem.json
(module.terrain) et écrit un CSV pré-rempli (movement-grid-arnhem.csv) pour
correction manuelle.

Limites connues (à corriger dans le CSV) :
- Seuls les 6 types de terrain "de zone" (Mixed/Woods/Broken/Rough/City/Town)
  sont couverts. Les éléments de bordure d'hex (route, sentier, rivière,
  ruisseau, bac, frontière, ponts) ne sont PAS détectés automatiquement — ce
  sont des lignes fines, pas des aplats de couleur, donc pas fiables par
  échantillonnage de couleur. Colonne "edges" laissée vide.
- Ville/Village (City/Town) ne sont PAS détectés par couleur (les icônes sont
  trop éparses pour influencer la couleur moyenne d'un hex) : la liste vient
  d'une lecture manuelle des noms imprimés sur la carte — probablement
  incomplète (villages non repérés) et approximative sur les cas Rough+ville
  (ex. Oosterbeek, sur fond orangé).
"""
import csv
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MAP_PATH = ROOT / 'public/modules/arnhem/images/arnhem-map.jpg'
MODULE_PATH = ROOT / 'public/modules/arnhem/arnhem.json'
CSV_PATH = ROOT / 'movement-grid-arnhem.csv'

CALIB = {'x0': 100.5, 'y0': 122, 'colStep': 81, 'rowStep': 93.25}
COLS, ROWS = 39, 26

TERRAIN_TYPES = {
    'mixed':  {'label': 'Mixed',  'mp': 2},
    'woods':  {'label': 'Woods',  'mp': 2},
    'broken': {'label': 'Broken', 'mp': 3},
    'rough':  {'label': 'Rough',  'mp': 4},
    'city':   {'label': 'City',   'mp': 1},
    'town':   {'label': 'Town',   'mp': 1},
}

# Couleurs de référence (RGB), mesurées sur la carte (cf. conversation).
REF_COLORS = {
    'mixed':  (201, 196, 177),
    'woods':  (120, 126, 39),
    'broken': (173, 162, 145),
    'rough':  (175, 134, 42),
}

# Colonies repérées manuellement en lisant les noms imprimés sur la carte
# (liste probablement incomplète — cf. docstring). hexId = "colrow" (2+2
# chiffres, col 1-based), format identique à celui imprimé sur la carte.
SETTLEMENTS = {
    # Villes (type city)
    '0103': 'city', '2421': 'city', '2422': 'city', '2521': 'city', '2522': 'city', '2622': 'city',
    '3423': 'city', '3424': 'city', '3523': 'city', '3524': 'city',
    # Villages (type town)
    '0702': 'town', '1004': 'town', '1306': 'town', '1308': 'town', '1411': 'town', '1412': 'town',
    '2209': 'town', '0410': 'town', '0812': 'town', '0115': 'town', '2116': 'town', '1816': 'town',
    '2320': 'town', '2020': 'town', '1923': 'town', '2323': 'town', '3019': 'town', '3224': 'town',
    '0920': 'town', '1220': 'town', '0623': 'town', '1324': 'town', '1623': 'town', '3613': 'town',
    '3618': 'town', '3619': 'town', '3620': 'town', '3621': 'town',
}


def hex_center(col1, row):
    c = col1 - 1
    yoff = CALIB['rowStep'] / 2 if c % 2 == 1 else 0
    x = CALIB['x0'] + c * CALIB['colStep']
    y = CALIB['y0'] + (row - 1) * CALIB['rowStep'] + yoff
    return x, y


def sample_color(im, x, y, box=22):
    left, top = max(0, int(x - box)), max(0, int(y - box))
    right, bottom = min(im.width, int(x + box)), min(im.height, int(y + box))
    crop = im.crop((left, top, right, bottom))
    px = list(crop.getdata())
    n = len(px)
    return tuple(sum(p[i] for p in px) / n for i in range(3))


def classify(rgb):
    best, bestd = None, float('inf')
    for name, ref in REF_COLORS.items():
        d = sum((rgb[i] - ref[i]) ** 2 for i in range(3))
        if d < bestd:
            best, bestd = name, d
    return best


def main():
    im = Image.open(MAP_PATH).convert('RGB')
    mod = json.loads(MODULE_PATH.read_text(encoding='utf-8'))
    # Forme réelle de la carte (cf. src/lib/mapShape.js) : les hexs retirés
    # (`map.removedHexes`) et la dernière ligne des colonnes décalées
    # (`map.evenColMinus` — colonnes 1-based PAIRES) n'existent pas, on ne
    # leur attribue aucun terrain.
    map_cfg = mod.get('map', {})
    removed = {h.strip() for h in str(map_cfg.get('removedHexes', '')).split(',') if h.strip()}
    even_col_minus = bool(map_cfg.get('evenColMinus'))
    grid = {}
    rows_out = []
    for col in range(1, COLS + 1):
        last_row = ROWS - 1 if even_col_minus and col % 2 == 0 else ROWS
        for row in range(1, last_row + 1):
            hex_id = f'{col:02d}{row:02d}'
            if hex_id in removed:
                continue
            if hex_id in SETTLEMENTS:
                terrain = SETTLEMENTS[hex_id]
                source = 'manual'
            else:
                x, y = hex_center(col, row)
                rgb = sample_color(im, x, y)
                terrain = classify(rgb)
                source = 'auto'
            grid[hex_id] = terrain
            rows_out.append({
                'hexId': hex_id, 'col': col, 'row': row,
                'terrain': terrain, 'mp': TERRAIN_TYPES[terrain]['mp'],
                'edges': '', 'source': source,
            })

    # Les couches d'arêtes ajoutées depuis (routes, pistes, rivières, ponts,
    # bacs...) sont conservées : seuls `types` et `grid` sont régénérés.
    mod['terrain'] = {**mod.get('terrain', {}), 'types': TERRAIN_TYPES, 'grid': grid}
    MODULE_PATH.write_text(json.dumps(mod, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    with CSV_PATH.open('w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=['hexId', 'col', 'row', 'terrain', 'mp', 'edges', 'source'])
        w.writeheader()
        w.writerows(rows_out)

    counts = {}
    for r in rows_out:
        counts[r['terrain']] = counts.get(r['terrain'], 0) + 1
    print(f'{len(rows_out)} hexs classés.')
    for k, v in sorted(counts.items()):
        print(f'  {k}: {v}')
    print(f'-> {MODULE_PATH}')
    print(f'-> {CSV_PATH}')


if __name__ == '__main__':
    main()
