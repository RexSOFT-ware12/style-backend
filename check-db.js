require('dotenv').config();
const { MongoClient } = require('mongodb');

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();

    const db = client.db(process.env.MONGODB_DB_NAME || 'FabricNow');

    console.log('Database:', db.databaseName);
    console.log('Products:', await db.collection('products').countDocuments());
    console.log('Taxonomies:', await db.collection('taxonomies').countDocuments());
    console.log('Fabrics:', await db.collection('fabrics').countDocuments());
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
