/**
 * Seeds src/data/db.json with starter products so the dashboard and the
 * storefront both have real, shared data to point at immediately.
 *
 * Run with: npm run seed   (safe to re-run — it overwrites products only)
 */
const { readDb, writeDb } = require("../db");
const { nanoid } = require("nanoid");

const now = () => new Date().toISOString();

const products = [
  {
    name: "AirFlex Runner",
    sku: "FN-SNK-001",
    price: 89,
    stock: 150,
    category: "Footwear",
    brand: "FabricNow",
    style: "Athletic",
    fabric: "Mesh",
    color: "Black/White",
    size: "M",
    image:
      "https://images.unsplash.com/photo-1579338559194-a162d19bf842?q=80&w=687&auto=format&fit=crop&ixlib=rb-4.1.0",
    description:
      "Lightweight running sneakers designed for speed and comfort. Breathable mesh and durable sole.",
  },
  {
    name: "Urban Street Pro",
    sku: "FN-SNK-002",
    price: 99,
    stock: 90,
    category: "Footwear",
    brand: "FabricNow",
    style: "Streetwear",
    fabric: "Leather",
    color: "White",
    size: "M",
    image:
      "https://images.unsplash.com/photo-1608667508764-33cf0726b13a?q=80&w=880&auto=format&fit=crop&ixlib=rb-4.1.0",
    description:
      "Minimalist sneakers for everyday wear. Premium leather with a modern urban look.",
  },
  {
    name: "Classic Court 90s",
    sku: "FN-SNK-003",
    price: 79,
    stock: 200,
    category: "Footwear",
    brand: "FabricNow",
    style: "Retro",
    fabric: "Canvas",
    color: "Cream",
    size: "M",
    image:
      "https://images.unsplash.com/photo-1465453869711-7e174808ace9?q=80&w=1176&auto=format&fit=crop&ixlib=rb-4.1.0",
    description:
      "Retro-inspired sneakers with a tennis court vibe. Perfect balance between comfort and style.",
  },
  {
    name: "Volt Edge",
    sku: "FN-SNK-004",
    price: 119,
    stock: 60,
    category: "Footwear",
    brand: "FabricNow",
    style: "Athletic",
    fabric: "Knit",
    color: "Volt Green",
    size: "M",
    image:
      "https://images.unsplash.com/photo-1512374382149-233c42b6a83b?q=80&w=735&auto=format&fit=crop&ixlib=rb-4.1.0",
    description:
      "Performance sneakers with bold details. Responsive cushioning for all-day energy.",
  },
  {
    name: "Zenith Flow",
    sku: "FN-SNK-005",
    price: 129,
    stock: 45,
    category: "Footwear",
    brand: "FabricNow",
    style: "Lifestyle",
    fabric: "Knit",
    color: "Grey",
    size: "M",
    image:
      "https://images.unsplash.com/photo-1608231387042-66d1773070a5?q=80&w=1074&auto=format&fit=crop&ixlib=rb-4.1.0",
    description:
      "Premium lifestyle sneakers blending high-quality knit material and futuristic design.",
  },
  {
    name: "Street Vibe Low",
    sku: "FN-SNK-006",
    price: 69,
    stock: 8,
    category: "Footwear",
    brand: "FabricNow",
    style: "Casual",
    fabric: "Canvas",
    color: "Navy",
    size: "M",
    image:
      "https://images.unsplash.com/photo-1511556532299-8f662fc26c06?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0",
    description:
      "Casual low-top sneakers with a timeless silhouette. Built for versatility and comfort.",
  },
  {
    name: "Nova Horizon",
    sku: "FN-SNK-007",
    price: 109,
    stock: 70,
    category: "Footwear",
    brand: "FabricNow",
    style: "Streetwear",
    fabric: "Suede",
    color: "Tan",
    size: "M",
    image:
      "https://images.unsplash.com/photo-1516767254874-281bffac9e9a?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0",
    description:
      "High-top sneakers crafted with suede and mesh. Perfect mix of streetwear and performance.",
  },
  {
    name: "Pulse React",
    sku: "FN-SNK-008",
    price: 99,
    stock: 130,
    category: "Footwear",
    brand: "FabricNow",
    style: "Athletic",
    fabric: "Mesh",
    color: "Red/Black",
    size: "M",
    image:
      "https://images.unsplash.com/photo-1560769629-975ec94e6a86?q=80&w=764&auto=format&fit=crop&ixlib=rb-4.1.0",
    description:
      "Dynamic sneakers with responsive cushioning. Designed for training and everyday comfort.",
  },
  {
    name: "Core Street Retro",
    sku: "FN-SNK-009",
    price: 85,
    stock: 5,
    category: "Footwear",
    brand: "FabricNow",
    style: "Retro",
    fabric: "Leather",
    color: "Brown",
    size: "M",
    image:
      "https://images.unsplash.com/photo-1621315271772-28b1f3a5df87?q=80&w=687&auto=format&fit=crop&ixlib=rb-4.1.0",
    description:
      "Old-school sneakers inspired by 80s basketball. Durable construction with vintage vibes.",
  },
  {
    name: "AeroFlex Lite",
    sku: "FN-SNK-010",
    price: 75,
    stock: 175,
    category: "Footwear",
    brand: "FabricNow",
    style: "Casual",
    fabric: "Mesh",
    color: "Sky Blue",
    size: "M",
    image:
      "https://images.unsplash.com/photo-1496202703211-aa28e9500c30?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0",
    description:
      "Ultra-light sneakers designed for everyday mobility. Breathable and flexible design.",
  },
];

function run() {
  const db = readDb();
  db.products = products.map((p) => ({
    id: nanoid(10),
    ...p,
    images: [p.image],
    featured: false,
    createdAt: now(),
    updatedAt: now(),
  }));
  writeDb(db);
  console.log(`Seeded ${db.products.length} products into db.json`);
}

if (require.main === module) run();

module.exports = run;
