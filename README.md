# Confirmation Clean Squad

Application web pour l'agent de confirmation, pensée d'abord pour le téléphone.

- Les commandes arrivent depuis Shopify. L'agent appelle le client, puis marque la commande **Tentative 1**, **Tentative 2**, **Confirmée** ou **Annulée**.
- Quand l'agent confirme, le colis est créé chez **Adex**.
- Ensuite, les statuts **En livraison**, **Livrée** et **En retour** se mettent à jour tout seuls depuis Adex.

Autres points :
- Aucune base de données. Le statut est enregistré dans Shopify (tag `cs-statut:…` et métachamps `cs.*`), donc il est aussi visible dans l'admin Shopify.
- Les gains de l'agent sont calculés automatiquement : 1 DT par commande confirmée, 2 DT si le panier contient le Pack Complet.
- Boutons Appeler et WhatsApp, bon de livraison Adex (PDF), suivi du colis, demande d'enlèvement.
- L'app s'installe sur l'écran d'accueil du téléphone (Partager → « Sur l'écran d'accueil »).

## 1. Clés Shopify (5 min)
1. Va sur **dev.shopify.com** → *Apps* → **Créer une app**, nomme-la « Confirmation ».
2. Dans *Versions*, partie accès API Admin, coche **read_orders** et **write_orders**, puis publie la version.
3. Sur l'accueil de l'app, clique **Installer** sur la boutique *The Clean Squad*.
4. Dans *Paramètres*, copie le **Client ID** et le **Client secret**.

## 2. Clés Adex
1. Sur my.adex.tn, ouvre **Mon Profil → Accès API REST** et génère le token.
2. Copie-le tout de suite : il ne s'affiche qu'une fois.
3. Ton identifiant de connexion Adex correspond à `ADEX_USER`.

## 3. Mise en ligne sur Render (gratuit)
1. Crée un dépôt GitHub privé et mets ce dossier dedans.
2. Sur render.com, choisis **New → Blueprint** puis sélectionne le dépôt. Le fichier `render.yaml` configure tout.
3. Remplis les variables : `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `ADEX_USER`, `ADEX_TOKEN`, `AGENT_PASSWORD` (le mot de passe de l'agent) et `ADMIN_PASSWORD` (le tien).
4. Lance le déploiement. L'adresse ressemblera à `https://cs-confirmation.onrender.com` : envoie-la à l'agent.

Sur le plan gratuit, le serveur s'endort après 15 min sans visite et la première ouverture prend environ 40 s. Le plan Starter (7 $/mois) le garde toujours actif.

## Variables
| Variable | Rôle |
|---|---|
| `SHOPIFY_SHOP` | `rgpbgc-fd.myshopify.com` |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | App du Dev Dashboard. À la place, tu peux utiliser `SHOPIFY_ADMIN_TOKEN` = `shpat_…` d'une ancienne app personnalisée |
| `ADEX_USER` / `ADEX_TOKEN` | Accès API REST Adex |
| `ADEX_TYPE` | Type de colis Adex, `FIX` par défaut (FIX, LGR, MOY, GRD, ONP, BLK, SMD) |
| `AGENT_PASSWORD` / `ADMIN_PASSWORD` | Mots de passe de connexion |
| `LAUNCH_DATE` | Masque les commandes plus anciennes qui n'ont pas de statut |
| `MOCK=1` | Mode démo avec de fausses commandes |

## Tester en local
```
npm install
npm run dev        # mode démo → http://localhost:3000, mot de passe : demo
```
