# Mes PDF · NovaSkillTech

Bibliothèque PDF en français, classée par thème, avec recherche, favoris locaux, lecture et téléchargement. Le back-office `/admin` permet de publier ou masquer les documents individuellement ou par sélection.

Les PDF, les couvertures, le catalogue complet et les données d’authentification sont conservés dans **Vercel Blob privé**. Ce dépôt public contient uniquement le code. Les nouveaux documents sont **masqués par défaut**.

## Déployer sur Vercel

1. Importer `novaskilltech/my-pdf` dans l’équipe Vercel souhaitée. Le framework est **Hono**, Node **24.x**, installation `npm ci`, build `npm run build`. `vercel.json` fournit ces paramètres.
2. Dans **Storage**, connecter un stockage **Blob privé** au projet et à son environnement Production. Le stockage `my-pdf-private` a déjà été créé dans l’équipe `novaskilltech's projects`, région Paris (`cdg1`). La connexion doit fournir `BLOB_STORE_ID` et les autorisations OIDC du projet, ou le jeton serveur `BLOB_READ_WRITE_TOKEN`.
3. Ajouter une variable sensible `ADMIN_SETUP_TOKEN` pour Production. Générer sa valeur localement avec :

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Ne jamais ajouter cette valeur au dépôt. Ne pas utiliser de préfixe public pour les variables. Le code d’installation doit contenir au moins 32 caractères.
4. Redéployer après la connexion du stockage et l’ajout de la variable. Sans stockage configuré, les API refusent les requêtes.
5. Ouvrir `https://VOTRE-DOMAINE/admin`, saisir le code d’installation et choisir un mot de passe d’au moins 14 caractères. Le compte ne peut être initialisé qu’une fois. Le code d’installation peut ensuite être supprimé des variables Vercel.
6. Dans l’administration, importer **Collection-PDF-NovaSkillTech.zip**, remis séparément et contenant les 103 entrées de la collection (100 PDF distincts). Le pack reste privé. Attendre la fin du classement avant de fermer la page.
7. Publier les documents souhaités. Le site public ne présente que ces documents et leurs catégories.

**État de la mise en ligne :** le dépôt est préparé. La création automatisée du projet Vercel a été refusée par le service (`403 forbidden`) avec la connexion disponible. Aucun déploiement Vercel réussi n’est revendiqué. Il faut d’abord importer le dépôt depuis un compte autorisé. Le stockage privé créé est encore à connecter au projet.

Pour les Preview Deployments, utiliser un stockage privé distinct et un code d’installation distinct, ou laisser les variables absentes. Ne pas connecter des modifications de code non approuvées au stockage Production.

## Administration

- `/admin` : connexion, recherche et filtres par thème ou visibilité.
- **Publier / Masquer** : effet immédiat sur les nouvelles requêtes au catalogue, au PDF et à sa couverture, sans reconstruire le site.
- **Aperçu** : l’administrateur connecté peut aussi lire les PDF masqués.
- La sélection groupée concerne les résultats affichés ; changer un filtre vide la sélection.
- Un nouvel import conserve la visibilité d’une entrée dont l’identifiant et le PDF sont inchangés. Les nouvelles entrées ou celles dont le PDF a changé sont masquées. Les documents absents du pack sont conservés.
- Changer le mot de passe invalide toutes les autres sessions. Session de 8 heures ; cookie `Secure`, `HttpOnly`, `SameSite=Strict`.
- En cas de mot de passe perdu, un propriétaire du stockage peut supprimer uniquement `my-pdf/auth.json`, remettre un nouveau `ADMIN_SETUP_TOKEN` et réinitialiser le compte. Cette opération invalide les sessions existantes sans toucher aux PDF.

Masquer bloque les nouveaux accès ; cela ne supprime pas les copies déjà téléchargées. Les changements ne retirent pas les éléments déjà affichés dans une page ouverte avant le masquage, mais leurs prochains téléchargements sont refusés.

## Fonctionnement

Hono traite les routes API. Vercel sert les fichiers statiques de `public/`. Les fichiers PDF ne passent jamais par un répertoire public : les routes `/api/documents/:id/file` et `/api/documents/:id/cover` contrôlent la visibilité ou la session avant de diffuser le contenu privé.

Le catalogue et l’authentification sont lus sans cache. Toutes les réponses API sont `no-store`, également pour le CDN Vercel. Les écritures utilisent les ETag et `ifMatch` pour éviter qu’une modification concurrente n’en écrase une autre. Les requêtes de modification exigent une origine identique et du JSON. Les tentatives d’accès sont limitées dans le stockage partagé, avec une limite globale adaptée à un seul administrateur.

Le pack ZIP est transféré directement depuis le navigateur vers Blob privé, avec une autorisation limitée à un chemin et à une heure. Le serveur contrôle les chemins, les tailles, les identifiants et les empreintes SHA-256 des PDF avant de mettre à jour le catalogue. Il accepte jusqu’à 500 entrées par pack, 180 Mo compressés, 230 Mo décompressés et 30 Mo par fichier. Les packs d’import restent privés sous `my-pdf/imports/` et peuvent être supprimés dans Vercel Storage après un import réussi. Le site ne synchronise pas automatiquement les futurs documents créés dans ChatGPT.

### Structure du pack

```text
catalog.json
pdf/<20 premiers caractères du SHA-256>.pdf
covers/<identifiant>.jpg
```

Les archives ne doivent pas inclure d’entrées de dossiers ni d’autres fichiers. Le catalogue comporte `categories` et `documents` ; les champs attendus et leur validation sont définis dans `src/lib/import.js`. Les données de la collection privée ne doivent jamais être ajoutées à Git.

## Développement et vérification

```sh
npm ci
npm run build
```

Le build vérifie la syntaxe, exécute les tests et prépare le module de transfert côté navigateur. Les tests utilisent un stockage mémoire isolé : initialisation, cookies, authentification, changements de mot de passe, limites de tentatives, contrôle d’origine, publication/masquage, accès direct aux fichiers, conflits de versions et import de ZIP.

Les tests locaux ne remplacent pas une vérification du déploiement réel : après import dans Vercel, vérifier la connexion Blob, la première configuration, le transfert du pack, puis publier et masquer un PDF depuis deux sessions distinctes (administrateur et navigation privée).

## Variables serveur

| Variable | Usage |
| --- | --- |
| `BLOB_STORE_ID` | Identifiant du stockage privé connecté ; utilisé avec l’identité OIDC Vercel. |
| `BLOB_READ_WRITE_TOKEN` | Alternative serveur si la connexion au stockage utilise ce mode. Ne jamais exposer au navigateur. |
| `ADMIN_SETUP_TOKEN` | Code initial aléatoire d’au moins 32 caractères. |

Aucun service d’envoi d’e-mails et aucune base de données supplémentaire ne sont nécessaires pour ce back-office à administrateur unique.
