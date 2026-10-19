# Pupitre ClayImmo : installation dans l'organisation Viva Viager Clay IMMO

Ce dossier contient tout ce qu'il faut pour recréer le Pupitre ClayImmo (validation par l'équipe des contenus réseaux sociaux, puis programmation automatique) dans l'organisation Claude « Viva Viager Clay IMMO ». Il est destiné à Claude, dans une conversation ouverte depuis l'organisation par Maneli Mirkhan (Owner).

Règles de rédaction : français, aucun tiret long ni demi-cadratin, aucun chiffre inventé.

## Ce que contient le dossier

- `index.html` : la page du Pupitre (HTML autonome). Elle lit deux collections de sa base de données : `sujets` et `items`. Capacités à déclarer à la publication : `{"db": {}, "user": {"scopes": ["profile"]}}`.
- `sujets.json` : un document par sujet (id, sujet, semaine, statut a_valider | valide | a_corriger | programme, note, par, le). L'équipe valide un sujet une seule fois ; la validation couvre toutes ses déclinaisons.
- `items.json` : une déclinaison par document (key, sujet_id, canal, format, date, titre, texte, media, fichier, statut, publication). Le champ `media` donne le chemin publié du fichier (par exemple `media/ci-r7_carrez-v6.mp4`) ; le fichier source est dans le dossier `media/` du même dépôt.
- `media-list.json` : la liste des 28 fichiers médias à publier avec la page (environ 110 Mo).
- `routine.md` : le texte de la tâche programmée quotidienne qui envoie les sujets validés.

## Étapes pour Claude, dans l'organisation

1. **Récupérer le dossier.** `git clone https://github.com/Dornair-gif/ClayImmomedia` dans le dossier de travail. Le dépôt est public.

2. **Publier la page.** Avec l'outil Artifact, publier `pupitre/index.html` comme nouvel artefact, titre « Pupitre ClayImmo », icône « calendar », capacités `{"db": {}, "user": {"scopes": ["profile"]}}`. Joindre les médias via `files`, en gardant exactement les chemins de `media-list.json` (clé `media/xxx`, source `media/xxx` du dépôt). Une publication est limitée à 64 Mo : publier la page avec les images et deux ou trois vidéos, puis compléter par d'autres publications sur la même URL (chaque publication ajoute ses fichiers à ceux déjà en ligne).

3. **Charger les données.** Avec l'outil ArtifactData, action `batch` sur l'URL du nouvel artefact : un `set` par document de `sujets.json` (collection `sujets`, doc_id = id, sans le champ id) et un `set` par document de `items.json` (collection `items`, doc_id = key). 33 écritures, en une ou deux fois (50 au plus par batch). Relire ensuite une fois la collection `sujets` pour vérifier.

4. **Connecter Zapier dans l'organisation** (Settings > Connectors), avec le compte Zapier de Maneli. La connexion YouTube y pointe déjà sur la chaîne ClayImmo (@clayimmo). Vérifier par l'action YouTube « Make API GET Request » sur `https://www.googleapis.com/youtube/v3/channels` (part=snippet, mine=true) que la chaîne renvoyée est bien « ClayImmo ».

5. **Créer la tâche programmée** quotidienne à 8h58, heure de Paris (`CRON_TZ=Europe/Paris 58 8 * * *`), avec le texte de `routine.md` dans lequel `{URL_PUPITRE}` est remplacé par l'URL du nouvel artefact. Notifications : push.

6. **Prévenir Maneli** que tout est en place, puis lui rappeler deux gestes :
   - partager le nouveau Pupitre avec l'équipe (menu Share, membres de l'organisation, droit d'édition pour qu'ils puissent valider) ;
   - demander, dans la conversation d'origine du compte personnel, de désactiver l'ancienne tâche « Pupitre ClayImmo · programmation des validations », pour éviter une double programmation.

## Ce qui ne change pas

- Le moteur de publication (Railway, projet clayimmo-media) et sa clé Buffer restent en place. Il lit `planned/*.json` dans ce dépôt et envoie à Buffer, au plus 7 posts à l'avance.
- Les publications déjà programmées (taxe foncière, taux, DPE, fonds de travaux sur Instagram ; Short taxe foncière sur YouTube) ne sont pas touchées.
- La tâche programmée doit pouvoir pousser sur ce dépôt GitHub. Si la session de l'organisation n'a pas cet accès, demander à Maneli de connecter GitHub dans l'organisation.
