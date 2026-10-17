# Safe QuasiAI -> FabricNow Shopfront migration

This migration is intentionally allow-listed.

It migrates only:

- `products`
- `taxonomies`

It does **not** migrate all QuasiAI collections. In particular it does not copy
users, profiles, security logs, payments, messages, Qwesi data, health data,
or other unrelated application collections.

## Before applying

Run:

```powershell
npm run migrate-quasiai-to-fabricnow
```

Review the counts. Expected source counts from the current database are:

- products: 32
- taxonomies: 72

FabricNow currently has 10 known dummy products and 0 taxonomies.

## Apply

After reviewing the dry run:

```powershell
npm run migrate-quasiai-to-fabricnow -- --apply --replace-dummy-products
```

The `--replace-dummy-products` flag removes only the known
`FN-SNK-001` through `FN-SNK-010` dummy Shopfront products from FabricNow.

QuasiAI is never modified.

## Important

Do not use the old migration script that loops over every source collection.
This version has a hard-coded allow-list:

```js
const SHOPFRONT_COLLECTIONS = ["products", "taxonomies"];
```

Workspace collections such as `fabrics` are deliberately excluded because
`fabrics` is not the Shopfront `taxonomies` collection.
