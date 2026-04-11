/**
 * Auto-Categorize Products Script
 * 
 * This script automatically categorizes products that have undefined/missing categories
 * based on intelligent pattern matching of product names.
 * 
 * Usage: node scripts/auto-categorize-products.js
 */

// Load environment variables
require('dotenv').config();

const { PrismaClient } = require('../prisma/generated/client');
const prisma = new PrismaClient();

// Category patterns for intelligent matching
const CATEGORY_PATTERNS = {
  'T-Shirts': ['t shirt', 'tshirt', 't-shirt', 'tee'],
  'Briefs': ['brief', 'bri', 'underwear', 'underware'],
  'Socks': ['sock', 'hosiery'],
  'Shirts': ['shirt'], // Must come after T-Shirts to avoid false matches
  'Pants': ['pant', 'trouser', 'jean'],
  'Accessories': ['belt', 'tie', 'cap', 'hat', 'wallet', 'watch'],
  'Innerwear': ['vest', 'inner'],
  'Sportswear': ['track', 'sport', 'gym'],
};

// Fallback category for items that don't match any pattern
const DEFAULT_CATEGORY = 'Uncategorized';

/**
 * Find or create a category by name
 */
async function findOrCreateCategory(name) {
  let category = await prisma.category.findUnique({
    where: { name }
  });

  if (!category) {
    console.log(`📦 Creating new category: ${name}`);
    category = await prisma.category.create({
      data: { name }
    });
  }

  return category;
}

/**
 * Determine the best category for a product based on its name
 */
function determineCategoryName(productName) {
  const nameLower = productName.toLowerCase().trim();

  // Check each category pattern
  for (const [categoryName, keywords] of Object.entries(CATEGORY_PATTERNS)) {
    for (const keyword of keywords) {
      if (nameLower.includes(keyword)) {
        return categoryName;
      }
    }
  }

  return DEFAULT_CATEGORY;
}

/**
 * Main categorization function
 */
async function categorizProducts() {
  console.log('🚀 Starting auto-categorization...\n');

  try {
    // Get all products - we'll check their category validity
    const allProducts = await prisma.product.findMany({
      select: {
        id: true,
        name: true,
        categoryId: true
      }
    });

    console.log(`📊 Checking ${allProducts.length} products for invalid categories...\n`);

    // Get all valid category IDs
    const validCategories = await prisma.category.findMany({
      select: { id: true, name: true }
    });
    const validCategoryIds = new Set(validCategories.map(c => c.id));

    // Find products with invalid categoryId
    const uncategorizedProducts = allProducts.filter(p => !validCategoryIds.has(p.categoryId));

    console.log(`📊 Found ${uncategorizedProducts.length} products with invalid categories\n`);

    if (uncategorizedProducts.length === 0) {
      console.log('✅ All products are already categorized!');
      return;
    }

    // Track categorization stats
    const stats = {};
    const updates = [];

    // Determine category for each product
    for (const product of uncategorizedProducts) {
      const categoryName = determineCategoryName(product.name);
      
      if (!stats[categoryName]) {
        stats[categoryName] = [];
      }
      stats[categoryName].push(product);

      updates.push({
        productId: product.id,
        categoryName: categoryName
      });
    }

    // Display preview
    console.log('📋 Categorization Preview:');
    console.log('─'.repeat(60));
    for (const [categoryName, products] of Object.entries(stats)) {
      console.log(`${categoryName}: ${products.length} products`);
      // Show first 3 examples
      products.slice(0, 3).forEach(p => {
        console.log(`  └─ ${p.name}`);
      });
      if (products.length > 3) {
        console.log(`  └─ ... and ${products.length - 3} more`);
      }
    }
    console.log('─'.repeat(60));

    // Ask for confirmation
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const confirmed = await new Promise((resolve) => {
      readline.question('\n❓ Apply these categorizations? (yes/no): ', (answer) => {
        readline.close();
        resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
      });
    });

    if (!confirmed) {
      console.log('\n❌ Categorization cancelled.');
      return;
    }

    // Apply categorizations
    console.log('\n⚙️  Applying categorizations...\n');
    let successCount = 0;
    let errorCount = 0;

    for (const { productId, categoryName } of updates) {
      try {
        // Find or create category
        const category = await findOrCreateCategory(categoryName);

        // Update product
        await prisma.product.update({
          where: { id: productId },
          data: { categoryId: category.id }
        });

        successCount++;
        process.stdout.write(`\r✅ Categorized: ${successCount}/${updates.length}`);
      } catch (error) {
        errorCount++;
        console.error(`\n❌ Error categorizing product ${productId}:`, error.message);
      }
    }

    console.log('\n');
    console.log('─'.repeat(60));
    console.log('✨ Categorization Complete!');
    console.log(`   Success: ${successCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log('─'.repeat(60));

    // Show final category breakdown
    console.log('\n📊 Final Category Distribution:');
    const allCategories = await prisma.category.findMany({
      include: {
        _count: {
          select: { products: true }
        }
      },
      orderBy: {
        products: {
          _count: 'desc'
        }
      }
    });

    allCategories.forEach(cat => {
      console.log(`   ${cat.name}: ${cat._count.products} products`);
    });

  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
categorizProducts()
  .then(() => {
    console.log('\n👋 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });
