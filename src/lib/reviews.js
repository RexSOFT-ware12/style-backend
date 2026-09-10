/**
 * Generates realistic-looking placeholder reviews for a newly created
 * product, so every product launches with some social proof instead of an
 * empty "0 reviews" state. Ratings are intentionally kept in the 4.0–4.9
 * range (never a perfect 5, never below 4) to look organic.
 */
const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "David", "Elizabeth", "Sarah", "Daniel", "Emma", "Chris", "Olivia", "Noah",
  "Ava", "Liam", "Sophia", "Ethan", "Mia", "Lucas", "Amara", "Kwame",
  "Priya", "Wei", "Carlos", "Fatima", "Yuki", "Zoe",
];

const LAST_INITIALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const COMMENT_TEMPLATES = [
  "Exactly what I was looking for — the quality feels premium and it arrived exactly as pictured.",
  "Really happy with this purchase. The fit and finish are great, would buy again.",
  "Great value for the price. Took a little while to get used to, but overall very satisfied.",
  "The material quality exceeded my expectations. Highly recommend to anyone on the fence.",
  "Solid product, does exactly what it says. Shipping was fast and packaging was secure.",
  "Love the design and attention to detail. A couple of minor nitpicks but nothing major.",
  "This has quickly become one of my favorites. Comfortable, stylish, and well made.",
  "Good quality overall. Not perfect, but definitely worth the price point.",
  "Impressed with how well this was made. Customer service was also very responsive.",
  "Pretty much matches the description and photos. Would recommend to friends.",
  "The craftsmanship really stands out. A few small imperfections but nothing deal-breaking.",
  "Better than I expected honestly. Will definitely be shopping here again.",
  "Nice product, works great for what I needed. Delivery was quicker than expected.",
  "Very satisfied with the purchase. The details and finishing are top notch.",
  "A great addition to my collection — comfortable, durable, and looks fantastic.",
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

/** Random rating between 4.0 and 4.9 inclusive, in 0.1 steps. */
function randomRating() {
  return Math.round((4 + Math.random() * 0.9) * 10) / 10;
}

function randomReviewerName() {
  return `${randomChoice(FIRST_NAMES)} ${randomChoice(LAST_INITIALS)}.`;
}

function randomPastDate(maxDaysAgo = 180) {
  const daysAgo = randomInt(1, maxDaysAgo);
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date;
}

/**
 * Builds an array of `count` (default: random 5–12) auto-generated reviews.
 * Each review: { reviewerName, rating, comment, verifiedPurchase, createdAt }
 */
function generateReviews(count) {
  const total = count ?? randomInt(5, 12);
  const usedComments = new Set();

  return Array.from({ length: total }, () => {
    // Avoid repeating the same comment twice within a single product where possible.
    let comment = randomChoice(COMMENT_TEMPLATES);
    if (usedComments.size < COMMENT_TEMPLATES.length) {
      while (usedComments.has(comment)) comment = randomChoice(COMMENT_TEMPLATES);
      usedComments.add(comment);
    }

    return {
      reviewerName: randomReviewerName(),
      rating: randomRating(),
      comment,
      verifiedPurchase: Math.random() > 0.2,
      createdAt: randomPastDate(),
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = { generateReviews, randomRating };
