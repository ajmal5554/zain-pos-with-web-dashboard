export interface AuditAttributeGroup { key: string; label: string; options: string[] }
export interface AuditSizeScale { name: string; sizes: string[] }
export interface AuditCategorySetup { name: string; brands: string[]; groups: AuditAttributeGroup[]; scales: AuditSizeScale[]; popularPrices?: Array<{ price: number; pieces: number }> }
export interface StockAuditSetup { revision: number; categories: AuditCategorySetup[] }
export interface SaveAuditSetupInput { operationId: string; expectedRevision: number; categories: AuditCategorySetup[] }

const group = (key: string, label: string, options: string[]): AuditAttributeGroup => ({ key, label, options });
export function defaultAuditCategory(name: string): AuditCategorySetup {
    const shirt = /shirt/i.test(name) && !/t[ -]?shirt/i.test(name);
    const top = /shirt|polo|kurta|kids|baba|blazer/i.test(name);
    const mundu = /mundu|dhoti/i.test(name);
    const pant = /pant|trouser|jean|chino/i.test(name);
    const inner = /inner|underwear/i.test(name);
    const groups = [group('pattern', 'Pattern', mundu ? ['Plain', 'Self-design'] : /jean|denim/i.test(name) ? ['Plain', 'Faded', 'Distressed', 'Acid Wash'] : ['Stripes', 'Checks', 'Prints', 'Plain']),
        group('fabric', 'Fabric', mundu ? ['Cotton', 'Handloom Cotton', 'Tissue Silk', 'Art Silk', 'Khadi Cotton']
            : pant ? ['Cotton Chino', 'Denim', 'Cotton Lycra Stretch', 'Linen Blend', 'Poly-Viscose Formal', 'Corduroy']
            : inner ? ['Combed Cotton', 'Cotton Spandex', 'Modal Blend', 'Hosiery Cotton']
            : ['Cotton', 'Corduroy', 'Linen', 'Cotton Blend', 'Denim', 'Satin', 'Lycra-Cotton', 'Lycra', 'Polyester Blend']),
        group('quality', 'Quality', []), group('color', 'Color', ['White', 'Color', 'Black', 'Navy', 'Sky Blue', 'Grey', 'Cream / Off-White', 'Beige', 'Maroon', 'Olive Green', 'Khaki', 'Mint Green'])];
    if (shirt) groups.unshift(group('collar', 'Collar / Neck', ['Regular Collar', 'Chinese Collar']), group('pocket', 'Pocket style', ['Single Pocket', 'Double Pocket', 'No Pocket']));
    else if (top) groups.unshift(group('collar', 'Collar / Neck', /kurta/i.test(name) ? ['Mandarin Collar', 'Round Neck', 'Nehru Collar'] : ['Round Neck', 'V-Neck', 'Polo Collar', 'Hooded']));
    if (pant) groups.unshift(group('pocket', 'Pocket style', ['Cross Pocket', 'Slash Pocket', 'Double Back Pocket', 'Single Back Pocket']));
    if (top) groups.splice(shirt ? 3 : 1, 0, group('sleeve', 'Sleeve', ['Full Sleeve', 'Half Sleeve', 'Sleeveless']));
    if (top || pant) groups.push(group('fit', 'Fit', ['Slim Fit', 'Regular Fit', 'Comfort Fit']));
    if (mundu) groups.unshift(group('border', 'Border', ['Plain White', 'Gold Kasavu', 'Silver Kasavu', 'Color Border', 'Double Border']), group('subtype', 'Type', ['Single', 'Double']));
    if (inner) groups.unshift(group('subtype', 'Type', ['Brief', 'Trunk', 'Vest', 'Boxer']));
    return { name, brands: [], groups, scales: mundu ? [{ name: 'Mundu', sizes: ['Single', 'Double'] }]
        : pant ? [{ name: 'Waist', sizes: ['28', '30', '32', '34', '36', '38', '40', '42'] }]
        : inner ? [{ name: 'Centimetres', sizes: ['75', '80', '85', '90', '95', '100', '105'] }, { name: 'Standard', sizes: ['S', 'M', 'L', 'XL', 'XXL'] }]
        : /accessor|belt|lungi/i.test(name) ? [{ name: 'One size', sizes: ['Free Size'] }]
        : [{ name: 'Standard', sizes: ['S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'] }, { name: 'Chest', sizes: ['36', '38', '39', '40', '42', '44', '46'] }] };
}
export const DEFAULT_AUDIT_CATEGORIES = ['Shirts', 'T-Shirts & Polos', 'Trousers/Pants', 'Jeans & Denims', 'Mundus & Dhotis', 'Kidswear', 'Innerwear', 'Accessories'];
