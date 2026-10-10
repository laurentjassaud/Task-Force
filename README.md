# Generic Wargame

Moteur générique de wargame hexagonal, jouable **en local** (un navigateur pour
tous les camps) ou **en ligne** (une room par partie, un joueur par camp).

- **Front** : Vue 3 + Vite (`src/`). Le plateau, la grille d'hex, le zoom/pan,
  les pions et toutes les règles vivent dans un composant réutilisable
  (`HexMap.vue`) et ses composables (`src/lib/`).
- **Serveur** (parties en ligne) : Node + Express + Socket.IO (`server/`). Il
  ne connaît ni les règles ni les pions : il conserve l'état d'une room
  (positions, tour, phase, pendules, journal partagé) et le rediffuse.
- **Modules** : chaque **boîte de jeu** (carte, pions, terrain, camps, tours…)
  est un dossier JSON servi statiquement (`public/modules/<id>/`),
  interchangeable sans toucher au moteur.

## Modules disponibles

`public/modules/index.json` liste les modules ; deux sont actifs :
- **Arnhem** (*A Bridge Too Far: Arnhem* — Opération Market-Garden, septembre
  1944) ;
- **Coral Sea** (*Battle of the Coral Sea* — 7-8 mai 1942) : carte hexagonale
  33 × 19, task forces japonaises (TF 1, 2, 3, 7, 8, 10 et leurres Dummy) et
  marqueurs de recherche (Detected!, Contact Lost, Misdirect). Aucun pion
  n'est posé au départ : tout part du panneau latéral (cf.
  `src/lib/useCoralSea.js`). Pas encore de règles propres (ni terrain, ni
  combat, ni pions américains) : à jouer en partie Libre.

Les autres (Hürtgen, Bastogne, Remagen) sont annoncés « Bientôt disponible ».

## Modes de jeu

Choisis à la création de la partie (assistant en 4 étapes en local, 5 en ligne
avec le nombre de joueurs) — cf. `src/lib/gameSettings.js`.

| Réglage | Valeurs | Effet |
|---|---|---|
| Scénario | Ceux du module — Arnhem : Historique (*Placement libre* : bientôt) | Déploiement |
| Météo | *bientôt disponible* | — (pas encore appliquée par le moteur) |
| Partie | **Libre** / **Assisté** | Voir ci-dessous |
| Timing | Libre / **Limité** / **Blitz** | Chronomètre de la phase de Mouvement — partie Assistée uniquement |

**Partie Libre** : un bac à sable. Glisser-déposer libre de tous les pions,
aucune restriction de tour ni de règle, dé libre.

**Partie Assistée** : l'application applique les règles.
- grille affichable, sélection au clic, contrôle limité au camp dont c'est le
  tour ;
- tour joué en phases : **Airborne** (pose des aéroportés, si le camp en a) →
  **Mouvement** → **Combat** → *Fin de tour* (dernier camp de l'ordre) ;
- points de mouvement et coûts de terrain (routes, pistes, ponts, bacs,
  rivières, ruisseaux), terrains interdits aux véhicules, zones de contrôle,
  empilement (une unité par hex en fin de mouvement), congestion des hex
  d'entrée des renforts, retour arrière et annulation de mouvement ;
- renforts : une unité entre en jeu à partir de son tour d'arrivée et peut
  attendre — sauf un largage, daté : la phase Airborne ne se termine pas tant
  qu'il reste une unité de la vague du tour à poser (à moins qu'aucune zone de
  largage ne soit libre) ;
- combat : désignation des cibles (plusieurs hex) et des attaquants, table de
  combat (CRT) avec dé, combats obligatoires, retraites hex par hex (avec
  refoulement d'amis), éliminations, avance après combat ; les unités ayant
  combattu pendant la phase portent un rond rouge en haut à gauche ;
- points de victoire (cf. `src/lib/useVictoryPoints.js`, `rules.victoryPoints`)
  : un total par camp, sous la tablette de soutien. En partie Libre, les
  joueurs le tiennent eux-mêmes (boutons − et +, saisie directe), chaque
  modification allant au journal ; en partie Assistée le moteur seul marque,
  et le bloc passe en lecture seule — une unité éliminée rapporte à son
  adversaire, et chaque Fin de tour paie les positions tenues au-delà d'un
  fleuve par une unité ravitaillée puis compte les unités coupées de leurs
  arrières au profit de l'adversaire. Une zone « au-delà d'un fleuve » n'est
  ni une ligne ni une liste d'hex : c'est la région que le fleuve isole,
  remplie depuis un hex témoin sans jamais franchir de rivière ;
- lignes de communication (cf. `src/lib/useSupplyLine.js`,
  `rules.supplyLine`) : chaque unité du camp concerné trace une suite continue
  d'hex jusqu'à ses arrières — une zone de largage de sa division pour les
  aéroportés (portée limitée), les hex sources du module pour les autres. La
  ligne suit alors une piste, puis une route, dès qu'elle est sur l'une ou
  l'autre : l'hex de l'unité compte comme premier hex de la ligne, si bien
  qu'une unité postée sur une piste ne peut plus couper à travers champs. Ni
  hex ennemi, ni ZOC ennemie (qu'une unité amie annule sur son hex), ni cours
  d'eau sans pont. Aucun effet de jeu pour l'instant : pendant la phase de Fin
  de tour, les unités coupées de leurs arrières sont cerclées de rouge sur la
  carte, et en mode debug un clic sur une unité surligne sa ligne en vert ;
- sort des ponts (cf. `src/lib/useBridges.js`) : un pont déclaré démolissable
  peut sauter dès qu'une unité du camp adverse borde l'un de ses deux hex, à
  n'importe quelle phase ; le camp qui le tient décide aussitôt (jet de dé,
  une seule tentative), après quoi le pont est détruit — l'arête redevient la
  rivière ou le ruisseau qu'il franchissait — ou définitivement sauf. Une
  unité du génie postée près d'un pont détruit peut ensuite le relever, si
  elle a passé tout le tour adverse hors de ses zones de contrôle : la
  réparation se confirme en phase de Fin de tour, et le pont redevient
  franchissable sans pouvoir être démoli à nouveau. Un rond rouge (détruit) ou
  vert (hors d'atteinte) marque l'hexside réglé ;
- artillerie (cf. `src/lib/useArtillery.js`) : barrage au contact ou à
  distance (cible dans la portée et observée par une unité amie, jamais
  affectée par le résultat), terrain de l'hex seul face à l'artillerie,
  « final protective fire » (FPF) du défenseur pendant le tour adverse,
  points rouge (résultat subi) et orange (refoulée) en haut à droite des
  pions ;
- règles particulières au module (cf. `src/lib/useArnhem.js` : déploiement
  initial, allocation réduite des aéroportés à l'arrivée, réduction des
  retraites en ville — refusée à l'artillerie aéroportée et aux unités
  encerclées, aéroportés et planeurs exceptés —, soutien au sol guidé
  seulement à 3 hex d'une unité alliée non aéroportée, au plus deux
  artilleries par camp dans un combat, passerelle du génie sur la rivière) ;
- passerelle du génie (cf. `src/lib/useArnhem.js`, `rules.engineerCrossing`) :
  un génie posté au bord d'une rivière, hors ZOC ennemie, ouvre un passage
  aux aéroportés et planeurs de son camp — ils franchissent l'hexside pour le
  seul coût d'entrée de l'hex, peuvent finir leur phase avec lui (il ne compte
  pas dans l'empilement) et, de son hex, doivent assaillir l'ennemi d'en face,
  combat résolu sur la ligne du ruisseau, sans le génie. Qui ne prend pas
  l'hex est éliminé ; le génie perdu se reconstitue et revient en renfort le
  tour suivant.

**Timings** (partie Assistée) : *Limité* accorde N minutes à **chaque** phase
de Mouvement (compte à rebours, clignote sous 20 s ; à zéro, le mouvement
s'arrête — il ne reste qu'à passer à la phase suivante) ; *Blitz*
donne à chaque camp un temps total pour toutes ses phases de Mouvement
(pendule d'échecs, une par camp, toujours visible) — à zéro, le camp **perd
la partie**.

## Journal de partie

Onglet « Journal » du panneau latéral (`JournalPanel.vue`) : chaque évènement
(déploiement, tour, phase, déplacement avec MP, entrée en jeu, combat,
retraite, avance, élimination…) y est inscrit avec de quoi le **rejouer**.
- **Local** : sauvegarde automatique (navigateur) proposée en reprise au
  chargement suivant ; export/import JSON ; lecteur de rejeu (pas à pas ou
  avance rapide). Une sauvegarde faite avec d'autres réglages relance la
  partie avec les siens.
- **En ligne** : journal **partagé**, conservé par le serveur et identique
  chez tous les joueurs (déploiement tiré une seule fois, éliminations,
  retours arrière…) ; un joueur qui recharge la page ou se reconnecte est
  réaligné sur le serveur. Export JSON toujours possible.

**Signaler un bug** (bouton de la barre d'outils du plateau,
`BugReportModal.vue`, `src/lib/bugReport.js`) : ouvre la création d'un ticket
GitHub pré-rempli (titre, description, contexte de la partie, 30 derniers
coups en clair). Le joueur le valide avec son propre compte GitHub. Le ticket
joint aussi un **export** compressé : état de la carte et 30 derniers coups
avec leurs données. Pour le lire :
`node scripts/decode-bug-report.mjs <export>`. Le dépôt cible se change avec
`VITE_GITHUB_REPO`.

## Parties en ligne

`/` liste les parties, `/create` en crée une (code d'accès affiché une seule
fois), `/room/:id` la rejoint (pseudo, camp, code). La partie démarre quand
tous les sièges sont pris. Le serveur reçoit l'ordre des camps à la création
et **refuse tout coup du joueur qui n'a pas la main** ; l'interface bloque de
même les actions hors tour. La liste des joueurs indique qui est en ligne.
Deux exceptions, où c'est le joueur SANS la main qui tranche — dans les deux
cas, le joueur actif soumet, l'autre répond, et le résultat est appliqué chez
tout le monde. Le **sort d'un pont** d'abord, démolition comme réparation (les
deux reviennent à des camps opposés) : l'occasion est soumise au camp qui doit
la trancher (`game:bridge-request`), qui décide sur son écran et publie
(`game:bridge`). Le **FPF** de l'artillerie ensuite, choisi par le défenseur.
Quand
un combat peut en recevoir un, l'attaquant le soumet d'abord au défenseur
(`game:fpf-request`). Celui-ci choisit ses artilleries sur son écran et
répond (`game:fpf-reply`), puis l'attaquant lance le dé. L'attaquant peut
renoncer tant que la réponse n'est pas arrivée (`game:fpf-cancel`). Le
serveur garde la négociation en cours (`fpfRequest`) pour qu'une page
rechargée la retrouve.

## Langue de l'interface

Sélecteur **FR / EN** dans la barre d'outils du plateau et en haut des autres
écrans (`LanguageSwitcher.vue`). Par défaut, la langue du navigateur
(français s'il le demande, anglais sinon) ; le choix du joueur est ensuite
mémorisé. Les textes vivent dans `src/i18n/fr.js` et `src/i18n/en.js`
(vue-i18n), avec les mêmes clés.
- Le **journal** reste dans la langue où il a été écrit : chaque ligne est
  rédigée dans la langue en cours au moment de l'évènement.
- Les noms d'**unités** et de **lieux** ne sont pas traduits.
- Les autres libellés d'un module (camps, scénarios, zones, résultats de
  combat…) sont écrits en français dans son JSON ; leur traduction se donne
  dans son dictionnaire `i18n` (cf. ci-dessous). Les onglets de renforts
  s'y traduisent aussi en entier (`"Renfort alliés": "Allied reinforcements"`).

## Anatomie d'un module

```
public/modules/<id>/
├── <id>.json          # tout ce qui suit
├── favicon.ico
└── images/            # carte, marqueurs, tables, counters/<faction>/*.png
```

Champs du JSON (cf. `arnhem.json`) :

| Champ | Contenu |
|---|---|
| `boardGame`, `name`, `favicon` | Identité (titre de page, icône d'onglet) |
| `i18n` | Traductions des libellés du module, par langue et indexées par le texte français : `{"en": {"Alliés": "Allies"}}` — un libellé absent reste en français (cf. `src/i18n/index.js::mt`) |
| `movementChart`, `combatChart` | Images des tables, affichables en jeu |
| `map` | `url`, `imageWidth/Height`, `cols`, `rows`, `evenColMinus` (colonnes décalées amputées d'une ligne), `removedHexes`, `calibration` (x0/y0/colStep/a/rowStep, en pixels de l'image) |
| `combat` | Table de combat : `die`, colonnes de différentiel, lignes de terrain (décalage), substitutions par hexside, résultats, libellés et **effets** de chaque résultat (retraite, élimination), avance après combat — cf. `src/lib/combatTable.js` ; sans table, pas de combat |
| `scenarios` | Scénarios proposés : `id`, `label`, `deployment` (`setup` — seul mode appliqué par le moteur ; `free` : bientôt), `weather` (`required` / `optional`) — cf. `src/lib/gameSettings.js` |
| `turnStructure` | Phases du tour d'un camp, en plus du Mouvement : `airbornePhase`, `combatPhase`, `endOfTurnPhase` (booléens) ; ou liste propre au module `phases: [{ id, label, kind? }]` (`kind` : `movement`/`combat`, sinon simple jalon) qui remplace Mouvement/Combat — cf. `src/lib/rules.js` |
| `rules` | Paramètres des règles génériques : `vehicleTypes`, `impassableForVehicles`, `stackingLimit` (nombre, ou `"none"` si le jeu n'a pas de règle d'empilement), `zoc` (`lockIfStarting`, `stopOnEntry`, `blocksRetreat`), `entryCongestion` (`multiply` / `none`), `mapExit` (sortie de carte : `side` autorisé et `zones` de bord `{ id, label, hexes }`, une unité sortie revenant en renfort par la même bande au tour suivant), `bridgeDemolition` (ponts démolissables : `layers` de la carte, camp `trigger` qui ouvre l'occasion, camp `by` qui décide, `destroyOn` du dé, `reveals`/`fallback` — l'obstacle que laisse un pont détruit), `bridgeRepair` (réparation : `layers` réparables, camp `by` qui répare, `unitTypes` capables de le faire, camp `undisturbedSide` dont le tour doit se passer hors ZOC), `supplyLine` (lignes de communication : camp `side`, `excludeFactions`, `blockingKinds`/`bridgeKinds` des hexsides, `ground` (`sources`, `stages`) et `airborne` (`range`)), et les valeurs des règles particulières du module (ex. `airborneArrivalSpentMp`, `groundSupportSpotterRange`, `maxArtilleryPerCombat`) — cf. `src/lib/rules.js` |
| `sides` | Camps jouables → factions (`{"allies": ["commonwealth","us","pol"], "german": ["german"]}`) |
| `turnTrack` | `turns`, `order` des camps, libellé, marqueur (et `color`) de chaque camp ; facultatifs : `turnInfo` (par tour : `time`, `initiative`, `movement`, `skipPhases`, `conditions`), `periods` (bandeaux Nuit/Jour...), `conditions` (lignes affichées) et `setup` (`{ side, label, short }` : étape de mise en place du camp `side` avant le tour 1) — cf. `src/lib/turnTrack.js` |
| `supportTrack` | Tablette de soutien : pions par tour (`byTurn`), camp propriétaire (`side`) et apport au combat d'un pion (`factor`, défaut 1) — cf. `src/components/SupportTracker.vue` et la section "PIONS DE SOUTIEN" de `src/lib/useCombat.js` |
| `terrain` | `types` (libellé, coût en MP), `grid` (hex → type), les couches d'arêtes (`roads`, `rivers`… : listes `"AAAA-BBBB"`) et `edges`, qui déclare ce que vaut chaque couche : coût fixe ou surcoût, infranchissable, interdite ou ouverte aux véhicules, coupe la ZOC ou l'attaque, et l'ordre de priorité quand plusieurs se superposent (mouvement / combat) — cf. `src/lib/edges.js` ; `edges.passages` nomme en plus la couche des hex coupés par une île (`{ "CCRR": { "couleur": [côtés] } }` : on ne ressort que par un côté de la couleur du côté d'entrée) — cf. `src/lib/passages.js` |
| `counters` | Par faction : `id`, `name`, `code`, `type`, `atk`/`def`/`mov` (ou `bar`/`fpf`/`range` pour l'artillerie), `src`, `turn` d'arrivée (`0` : posé à la mise en place, cf. `turnTrack.setup`), `setup`, `multiple` (`true` : pion en nombre illimité, qui reste dans le panneau après chaque pose — ex. leurres) |

`setup` (hex d'entrée) : `"0604"` (cet hex), `"0901-2301"` (plage de bord de
carte), `"3719+adj"` (largage : l'hex ou l'un de ses 6 voisins — c'est ce
suffixe qui fait d'un pion un **aéroporté**), `"*"` (n'importe quel hex de la
carte, jamais posé d'office). Un pion `type: "marker"` (zones
de largage « DZ ») n'est pas une unité (cf. `src/lib/units.js`).

La **calibration** pixel de la grille (`map.calibration`) est ajustable en
direct via le panneau « calibration » ; `src/lib/calibration.js` ne garde
qu'un repli pour un module qui n'en déclarerait pas.

Les **règles particulières** d'un module (ce qu'aucun champ du JSON ne sait
exprimer) vivent dans un composable dédié inscrit dans le registre
`src/lib/moduleRules.js` — `src/lib/useArnhem.js` sert de patron.

## Organisation du code

```
src/
├── views/        GamesList, CreateGame, LocalGameSetup, DemoPlay (plateau local), RoomLobby (plateau en ligne)
├── i18n/         textes de l'interface (fr.js, en.js), langue courante, libellés des modules
├── components/   HexMap (plateau et orchestration), TurnTracker, SupportTracker, Counter,
│                 ReinforcementsPanel, EliminatedPanel, JournalPanel, SidePanel, CombatModal,
│                 BridgeModal, VictoryPoints, VictoryModal, PhaseBlockedModal, MoveTimer,
│                 RollModal, MovementChartModal,
│                 CombatChartModal,
│                 CalibrationPanel, ContextMenu, GameSetupSteps, LanguageSwitcher
└── lib/
    ├── useAssisted.js   mode Assisté : phases, MP/terrain, ZOC, empilement, congestion
    ├── useCombat.js     cibles/attaquants, lecture de la table, combats obligatoires, FPF
    ├── useArtillery.js  artillerie : contact, tir à distance, FPF, résultats subis, refoulements
    ├── combatTable.js   table de combat du module (module.combat) : vérification et lecture
    ├── useRetreat.js    retraites, éliminations, avance après combat
    ├── useBridges.js sort des ponts : démolition, réparation par le génie, ponts détruits ou saufs
    ├── useSupplyLine.js lignes de communication : tracé jusqu'aux arrières, ZOC, cours d'eau
    ├── useVictoryPoints.js points de victoire : totaux, éliminations, zones au-delà des fleuves
    ├── moduleRules.js   registre des règles particulières par module
    ├── useArnhem.js     règles particulières du module Arnhem (patron pour d'autres modules)
    ├── useCoralSea.js   règles particulières du module Coral Sea (aucun pion posé au départ)
    ├── rules.js         paramètres des règles génériques (module.rules), structure du tour (module.turnStructure)
    ├── turnTrack.js     piste de tour détaillée (initiative, détail et conditions par tour, mise en place)
    ├── setup.js         notation `setup` des pions (hex, plage, largage)
    ├── edges.js         nature des hexsides (terrain.edges) : mouvement, ZOC, combat
    ├── passages.js      hex coupés par une île : côtés coloriés, sortie selon le côté d'entrée
    ├── useDebug.js      affichages de debug (coûts, portée, congestion)
    ├── units.js         qu'est-ce qu'une unité / un marqueur / un pion de soutien
    ├── hex.js, mapShape.js, calibration.js   géométrie de la grille
    ├── gameSettings.js, journalStorage.js    réglages de partie, sauvegarde/reprise
    └── api.js, socket.js                     accès au serveur
server/src/
├── index.js      Express + Socket.IO, purge périodique des parties
├── rooms.js      état des rooms (en mémoire), contrôle de tour, journal partagé
├── socket.js     évènements temps réel (join, move, turn, phase, log, deploy, over)
└── routes/games.js   API REST : créer / lister / lire une partie
```

## Développement

```sh
npm install                 # front
(cd server && npm install)  # serveur

npm run dev                 # front sur http://localhost:5173
(cd server && npm run dev)  # serveur sur http://localhost:3001 (rechargé à chaque modification)

npm run build               # build de production (mode production, cf. .env.production)
npm run preview
```

Variables d'environnement : `VITE_API_URL` (front → URL du serveur, défaut
`http://localhost:3001`) ; `PORT` et `CLIENT_ORIGIN` (serveur, défauts `3001`
et `http://localhost:5173`). Pour un hébergement Apache, `public/.htaccess`
relaie `/api` et `/socket.io` vers le serveur Node (port 8080) et assure le
repli SPA.

Prérequis : Node `^22.18.0` ou `>=24.12.0` (voir `engines`).

Le serveur garde tout **en mémoire** : les parties disparaissent à son
redémarrage, et les rooms abandonnées sont purgées (6 h sans joueur pour une
room jamais lancée, 72 h pour une partie lancée).

## Scripts

`scripts/` contient les générateurs utilisés pour construire le module Arnhem
(relançables si les données source changent) :

- `apply-german-counters.mjs` — installe les images de pions allemands et
  regénère `counters.german` dans le JSON ;
- `gen-terrain-grid.py` — classe le terrain de chaque hex par échantillonnage
  de couleur (Python 3 + Pillow), écrit `terrain.types`/`terrain.grid` (les
  couches d'arêtes sont conservées) et un CSV de correction manuelle ;
- `gen-terrain-artifact.mjs` — page HTML autonome (carte + grille colorée +
  coûts) pour vérifier visuellement le terrain ;
- `build-terrain-transition.mjs` — convertit l'export de cette page (routes,
  pistes, hex retirés, corrections) en fichier de transition à relire avant
  application.

## Limites connues

- « Placement libre » (déploiement `free`) et « Météo » sont proposés grisés :
  le moteur ne les applique pas encore.
- Certaines règles restent propres à un module et vivent donc dans son
  composable de règles particulières (`src/lib/useArnhem.js` : déploiement
  initial, arrivée des aéroportés, retraite en ville, portée du soutien au
  sol, plafond d'artilleries par combat) ; la sémantique des
  résultats de combat se limite à retraite / élimination / avance.
- Pas de suite de tests automatisée dans le dépôt (les vérifications se font
  par scripts ad hoc et navigateur automatisé).
