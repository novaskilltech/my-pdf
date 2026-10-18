# Mes PDF · NovaSkillTech

Le dépôt rassemble le code de la bibliothèque web, son back-office administrateur et **les liens vers les 103 PDF**, classés en **10 thèmes**. La collection complète est accessible depuis ce dépôt via un pack téléchargeable.

## Accéder aux documents

- **[Parcourir les 103 PDF par thème](collection/README.md)** : un lien individuel pour chaque entrée, avec sa langue et son nombre de pages.
- **[Télécharger le pack complet des PDF](https://chatgpt.com/api/library/files/libfile_a5016ff593ac8191a75383600707b1ff/download)** : catalogue original, 100 fichiers PDF distincts et 100 couvertures, soit environ 89 Mo compressés. Les 103 entrées incluent des versions et fichiers identiques conservés dans l’historique.
- **[Catalogue JSON pour les outils](collection/collection.json)** : identifiants, thèmes, liens individuels, chemins dans le pack, tailles et empreintes SHA-256.
- **[Notice de reprise pour Antigravity](docs/REPRISE_ANTIGRAVITY.md)** : organisation des fichiers et correspondance avec le catalogue original.

**Les liens de téléchargement nécessitent une connexion au compte ChatGPT propriétaire.** Les PDF restent protégés, même si ce dépôt est public. Leurs octets ne sont pas inclus dans un `git clone` : télécharger le pack pour disposer de tous les fichiers en local. Ce choix permet de référencer toute la collection sur GitHub sans rendre accessibles au public les documents administratifs et clients.

Le pack est une photographie de la collection au 18 octobre 2026. Les liens individuels pointent vers la version courante de chaque fichier dans ChatGPT. Les empreintes du JSON concernent les PDF du pack. Le catalogue original complet, les noms des fichiers et les miniatures se trouvent dans ce pack ; certains intitulés administratifs sont abrégés dans l’index public.

## Code de l’application

- `public/` : interface française, catégories, recherche, favoris locaux, lecture PDF et administration.
- `src/application.js` : routes du catalogue, authentification, publication/masquage et import.
- `src/lib/` : session administrateur, catalogue, stockage et contrôle des imports.
- `test/` : tests de l’authentification, des droits d’accès, du masquage, des imports et des modifications concurrentes.
- `collection/` : index de la collection et catalogue JSON de référence.

Le back-office permet de publier ou masquer les documents, individuellement ou par sélection. Les nouveaux documents sont masqués par défaut. La gestion de la base et son adaptation sont confiées à Antigravity. L’adaptateur serveur existant utilise Vercel Blob ; les informations techniques correspondantes sont conservées dans [la documentation de l’application](docs/application-existante.md).

## Vérifier le code

Node.js 24 :

```sh
npm ci
npm run build
```

Le build vérifie la syntaxe, exécute les tests et prépare le module de transfert du navigateur. L’accès au catalogue et aux PDF depuis l’application nécessite un stockage configuré côté serveur.
