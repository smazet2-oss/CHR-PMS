# CHR PMS — Les Trois Sources

Simulateur de logiciel hôtelier (PMS) pour la formation au TP Réceptionniste.
Toutes les données (clients, sociétés, réservations) sont fictives.

## Ce que fait le site

- Page de connexion : un compte par personne (`stephanie`, `floriane`, `soukayna`, `yasmine`).
- Session partagée : ce qu'une participante fait (réservation, check-in, encaissement…) apparaît en direct sur les autres postes.
- Chaque poste est nommé ; les opérations sont signées au prénom ; la formatrice voit le **Journal des manipulations** et les corrigés.
- Aucune dépendance : Node 22 suffit.

## Mise en ligne sur Render

1. Sur Render : **New > Blueprint**, choisir ce dépôt, valider.
2. Une fois le service créé : onglet **Environment** → les mots de passe `PASS_STEPHANIE`, `PASS_FLORIANE`, `PASS_SOUKAYNA`, `PASS_YASMINE` y sont générés. Les communiquer à chaque personne (ou les remplacer par des mots de passe choisis).
3. L'adresse du site s'affiche en haut de la page du service (ex. `https://chr-solution.onrender.com`).

Le disque `/var/data` conserve la session et le journal entre deux redémarrages (offre payante « Starter »).
Sans disque, tout repart de zéro à chaque redémarrage.

## Ajouter ou retirer une personne

Dans `src/server.js`, tableau `COMPTES` : ajouter une ligne `{ login, nom, env }`, puis créer la variable de mot de passe correspondante sur Render.
Pour qu'elle soit reconnue par son prénom dans le PMS, ajouter aussi son prénom au tableau `PARTICIPANTES` de `public/pms.html`.
Un compte sans mot de passe défini est désactivé.

## En local

```
PASS_STEPHANIE=test PASS_FLORIANE=test node src/server.js
```
puis ouvrir http://localhost:3000
