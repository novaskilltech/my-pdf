# Reprise de Mes PDF avec Antigravity

Le dépôt contient le code de l’application et tous les liens de la collection. La gestion de la base de données appartient au travail réalisé avec Antigravity.

## Récupérer les fichiers

1. Depuis le [README principal](../README.md), ouvrir le lien du pack complet dans un navigateur connecté au compte ChatGPT propriétaire.
2. Télécharger `Collection-PDF-NovaSkillTech.zip`, puis le décompresser dans un dossier local privé.
3. Le pack contient `catalog.json`, `pdf/` et `covers/`. Il comprend 103 entrées de catalogue, 100 PDF distincts et 100 couvertures.
4. Faire correspondre les entrées de `catalog.json` et de `collection/collection.json` par leur identifiant `doc-…`.

Les liens ChatGPT exigent une session propriétaire. Un agent sans cette session ne pourra pas les télécharger directement. Pour travailler avec Antigravity, lui fournir le pack téléchargé ou son dossier décompressé dans l’environnement de travail autorisé.

## Structure des données

`collection/collection.json` est l’index présent dans GitHub :

- `categories` : identifiant, nom, libellé court, couleur, icône et description des thèmes.
- `documents` : identifiant stable, titre d’index, thème, langue, pages, taille, lien de téléchargement et chemins dans le pack.
- `sha256` de chaque document : empreinte du PDF correspondant dans le pack.
- `visible` : `false` pour toutes les entrées ; la publication doit résulter d’un choix de l’administrateur.
- `pack` : lien de téléchargement, taille et empreinte SHA-256 de l’archive.

Le `catalog.json` à l’intérieur du pack contient le détail original : titres complets, auteurs, noms des fichiers, éditions, dates, textes de recherche, chemins PDF et couvertures. Utiliser cette source complète pour importer les données dans la base choisie. L’index GitHub évite de publier des détails administratifs ou clients.

Deux entrées peuvent référencer le même PDF : cela explique les 103 entrées pour 100 fichiers. Conserver les identifiants de toutes les entrées et dédupliquer les octets par empreinte si nécessaire.

## Points d’intégration dans le code

- `src/lib/storage.js` fournit l’adaptateur actuel : lecture/écriture JSON, lecture de fichier et ajout de fichiers. Il utilise Vercel Blob.
- `src/lib/catalog.js` filtre les entrées publiques et gère les changements de visibilité avec un contrôle des modifications concurrentes.
- `src/lib/auth.js` gère le compte administrateur et les sessions.
- `src/lib/import.js` valide les archives et leurs fichiers avant de mettre à jour le catalogue.
- `src/application.js` expose les routes API ; `public/app.js` et `public/admin.js` les consomment.

La reprise de la base peut remplacer cet adaptateur et les mécanismes d’import/authentification selon l’architecture retenue. Conserver le contrôle côté serveur : un PDF masqué, sa couverture et ses métadonnées doivent rester inaccessibles au public, même via un lien direct. Les seuls contrôles d’affichage dans le navigateur ne suffisent pas.

## Vérifier la collection récupérée

L’archive doit peser exactement le nombre d’octets indiqué dans `pack.size_bytes`, et son SHA-256 doit correspondre à `pack.sha256`. Pour chaque entrée, vérifier le fichier à `archive_pdf_path` et son empreinte `sha256`. Les versions courantes téléchargées individuellement peuvent avoir changé depuis la création du pack.

La collection est datée du 18 octobre 2026. Les futurs PDF nécessiteront un ajout au catalogue ; aucune synchronisation automatique n’est configurée.
