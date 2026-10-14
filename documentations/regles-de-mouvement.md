# Règles de mouvement

État des règles de mouvement en place au 14/10/2026, de la plus générale à la plus spécifique, suivi des contradictions relevées dans le modèle.

Sources lues : [useAssisted.js](../src/lib/useAssisted.js), [edges.js](../src/lib/edges.js), [passages.js](../src/lib/passages.js), [autoMove.js](../src/lib/autoMove.js), [rules.js](../src/lib/rules.js), [coral-sea.json](../public/modules/coral-sea/coral-sea.json), [useCoralSea.js](../src/lib/useCoralSea.js), `runAutoMoves` dans [HexMap.vue](../src/components/HexMap.vue).

## 1. Règles du moteur, valables pour tous les modules

- **Mode Libre** : aucune règle, n'importe quel pion se glisse n'importe où. Tout ce qui suit ne vaut qu'en **mode Assisté**.
- **Qui bouge** : seul le camp actif déplace ses pions, et seulement pendant une phase de type « movement ». Dans les autres phases, on ne peut pas sélectionner de pion pour le déplacer.
- **Comment** : on clique le pion, puis un hex **adjacent**. On avance d'un hex par clic.
- **Potentiel de mouvement (MP)** : il est pris dans cet ordre de priorité :
  1. la règle particulière du module ;
  2. la piste de tour (`turnInfo.movement`) ;
  3. le `mov` du pion.

  Un pion sans aucune de ces valeurs a un mouvement illimité.
- **Remise à zéro des MP** : les MP ne se reportent jamais. Ils repartent à zéro à chaque changement de pas de la piste, donc à chaque créneau.
- **Coût d'entrée dans un hex** :
  - de base, c'est le coût du terrain de l'hex (1 MP par défaut) ;
  - une arête à coût fixe (`mp`, comme une route) remplace ce coût ;
  - une arête à surcoût (`extraMp`, comme un gué) s'y ajoute.
- **Arêtes** :
  - une arête `impassable` est fermée à tout le monde ;
  - une arête `vehicles: false` est fermée aux véhicules ;
  - une arête `vehicles: true` ouvre aux véhicules un terrain qui leur est autrement interdit.
- **Hex coupés par une île** : on ne ressort que par un côté de la même couleur que le côté d'entrée. Un pion posé dans l'hex (sans côté d'entrée connu) peut en sortir par n'importe quel côté.
- **ZOC (zones de contrôle)** :
  - les 6 hex autour d'une unité ennemie sont sous sa ZOC, sauf à travers une arête `blocksZoc` ;
  - une unité qui **commence** son mouvement en ZOC ennemie ne bouge pas ;
  - une unité qui **entre** en ZOC ennemie s'y arrête.
- **Empilement** :
  - une unité ne termine jamais son mouvement au-delà de `stackingLimit` unités amies dans un hex ;
  - on peut traverser un hex ami, à condition de pouvoir en repartir ;
  - exception : un ami qui n'a pas encore bougé (et qui peut encore partir) ne compte pas ;
  - on ne peut pas désélectionner une unité en surplus d'empilement ;
  - un contrôle en fin de phase bloque le passage à la phase suivante s'il reste un empilement.
- **Fin du mouvement d'une unité** : une unité qui a bougé puis qui est désélectionnée est verrouillée pour le reste du tour. Deux annulations restent possibles : « Retour arrière » (un pas) et « Annuler le mouvement » (retour au point de départ).
- **Renforts** : ils paient un coût d'entrée. Avec `entryCongestion: multiply`, la N-ième entrée par un même hex dans le même tour coûte N fois ce coût.
- **Sortie de carte** : aucune (`mapExit: null`).

## 2. Paramètres de la mer de Corail (fichier JSON)

- **Terrain** : aucun type de terrain n'est déclaré, donc **chaque hex coûte 1 MP**.
- **Barrières côtières** (`seaBarriers`, 126 arêtes) : elles sont infranchissables et coupent la ZOC et l'attaque.
- **Passages d'île** (`seaPassages`, 13 hex) : ils appliquent la règle des côtés colorés.
- **Empilement** : `stackingLimit: 1`. La ZOC n'est pas déclarée, donc **ses valeurs par défaut s'appliquent : les deux règles sont actives**.
- **Potentiel** : 2 hex de nuit, 1 hex de jour, pour tous les camps.
- **Phases entremêlées** : on joue le Mouvement naval du camp qui a l'initiative, puis celui de l'autre camp. C'est la seule phase où l'on bouge.
- **Mise en place US** (tour 0) : les task forces se posent n'importe où sur la carte (`setup "*"`), sans aucun déplacement.
- **Déploiement japonais** : seuls les 12 leurres sont posés au départ, tirés dans la bande 0601-2701.

## 3. Règles particulières de la mer de Corail ([useCoralSea.js](../src/lib/useCoralSea.js))

- **Allure transport (AK)** :
  - elle vaut 1 hex si la piste coche « Mouvement AK », 0 sinon ;
  - concrètement : 1 hex de nuit (au lieu de 2), et 0 aux tours de jour pairs ;
  - elle concerne TF7, TF8, TF10, les leurres tirés « transport » à pile ou face, et les suiveurs d'une tête de groupe qui est un transport.
- **Le moteur joue les Japonais** :
  - il agit une seule fois par créneau, au début du Mouvement naval japonais : d'abord les meneurs, puis les suiveurs ;
  - le chemin est le plus court qui respecte les barrières et les passages ;
  - il n'entre jamais dans un hex ennemi et ne s'arrête jamais sur un hex ami ;
  - il est limité par les MP, et s'arrête dès que les règles refusent un pas (ZOC, par exemple).
- **Hex-objectifs** :
  - chaque meneur en tire un parmi `ijnArrivalHexes`, différent des autres tant que c'est possible ;
  - TF1, TF2 et TF3 reçoivent des objectifs groupés, à 5 hex au plus d'un même centre.
- **Suiveurs** :
  - ils restent adjacents à leur meneur ;
  - si le meneur disparaît, le suiveur reprend son objectif et devient meneur à son tour.
- **Mouvements particuliers** (ils remplacent la marche vers l'objectif) :
  - TF7 et TF8 restent à plus de 6 hex de toute task force alliée repérée ;
  - TF1 et TF2 foncent jusqu'à 5 hex du « Sighted Carrier » le plus proche. La première arrivée attend l'autre à 6 hex, pendant 2 tours au maximum ;
  - TF1 ou TF2 repérée, sans porte-avions allié repéré : elle reste à plus de 6 hex de toute unité alliée.
- **Renfort de leurres** (tours 11 et 23) :
  - côté japonais, chaque leurre est posé sur l'hex de l'unité qu'il suivra, puis il s'en écarte ;
  - côté US, le joueur pose ses leurres sur ses propres task forces avant tout mouvement, jusqu'à 12 task forces sur la carte, puis il doit les écarter.

## 4. Contradictions internes

1. **Empilement à 1, alors que des commentaires disent « aucun »**. Le JSON est passé de `"none"` à `1`, mais [rules.js:25-27](../src/lib/rules.js#L25-L27) et [HexMap.vue:719-720](../src/components/HexMap.vue#L719-L720) affirment encore qu'il n'y a pas de limite à la mer de Corail. Deux conséquences :
   - la mise en place US `"*"` ne vérifie pas l'empilement ([HexMap.vue:2707](../src/components/HexMap.vue#L2707)). Le joueur peut donc empiler à la mise en place, puis se retrouve bloqué à la fin de son premier Mouvement ;
   - les leurres japonais du renfort sont posés **sur** leur meneur. Si aucun hex adjacent n'est libre, l'empilement reste, et c'est le joueur qui est bloqué en cliquant « suivant ».

2. **La ZOC terrestre s'applique entre navires**. Les deux règles par défaut sont actives. Une task force US adjacente à un leurre japonais est figée, et le leurre aussi. Ce blocage mutuel peut durer jusqu'à ce qu'un « Detected! » retire le leurre. Le fait que les barrières soient déclarées `blocksZoc` suggère que c'est voulu, mais le blocage mutuel ressemble à un effet de bord. Par ailleurs, seule la ZOC empêche un joueur US d'entrer dans un hex ennemi : [canEnterHex](../src/lib/useAssisted.js#L1261) ne teste pas si l'hex est occupé par l'ennemi. Si on désactive la ZOC, cette entrée deviendra possible.

3. **L'en-tête de useCoralSea ne correspond plus au code**.
   - Le commentaire ([useCoralSea.js:17-36](../src/lib/useCoralSea.js#L17-L36)) dit : 5 leurres porteurs, 7 vrais leurres, et un « faux couple » formé des 2 restants.
   - Le code ([useCoralSea.js:193-200](../src/lib/useCoralSea.js#L193-L200)) liste **6** task forces, TF10 comprise. Il y a donc 6 porteurs et 6 vrais leurres, et ces 6 vrais leurres servent tous d'escortes : **le faux couple n'existe jamais**.

4. **`hexForbidden` est documenté mais pas implémenté**. [useAssisted.js:1231-1232](../src/lib/useAssisted.js#L1231-L1232) mentionne les « abords de l'aérodrome pour les pions japonais (cf. useCoralSea) », mais useCoralSea n'implémente pas cette règle. C'est probablement un reste de l'ancien module Arnhem.

5. **Une même task force peut exister deux fois sur la carte**. Les vrais pions japonais TF1…TF10 (bande 0501-2701) restent posables depuis le panneau, alors que des leurres les portent déjà en secret. Le pion et son leurre recevraient chacun un objectif et un mouvement particulier. La reconnaissance dédoublonne déjà ce cas ([useCoralSea.js:514-517](../src/lib/useCoralSea.js#L514-L517)), mais pas le mouvement.

6. **TF10 est un transport sans comportement de fuite**. Elle se déplace comme TF7 et TF8, mais elle est absente de `AVOIDING_TASK_FORCES` ([useCoralSea.js:182](../src/lib/useCoralSea.js#L182)) et marche donc droit vers son objectif. C'est peut-être voulu, à confirmer.

Les points 1, 3 et 4 sont des incohérences certaines (code ou commentaires). Les points 2, 5 et 6 dépendent de ce que prévoit la règle du jeu.
