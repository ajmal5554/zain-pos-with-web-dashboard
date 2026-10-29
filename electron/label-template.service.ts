import { validateLabelLayout, validateStickerConfig } from '../src/lib/labelTemplate';
import type { SaveLabelTemplateInput } from '../src/lib/labelTemplate';

export async function saveLabelTemplate(prisma: any, input: SaveLabelTemplateInput, user: any) {
    if (!user || user.isActive === false || !(user.role === 'ADMIN' || user.permEditSettings)) throw new Error('Permission denied: label setup requires settings access.');
    const blocks = validateLabelLayout(input?.blocks), config = validateStickerConfig(input?.config);
    if (input.expectedLayout !== null && typeof input.expectedLayout !== 'string' || input.expectedConfig !== null && typeof input.expectedConfig !== 'string') throw new Error('Reload the saved template before saving.');
    const layoutValue = JSON.stringify(blocks), configValue = JSON.stringify(config);
    return prisma.$transaction(async (tx: any) => {
        // Acquire the SQLite writer lock before comparing saved settings.
        await tx.$executeRawUnsafe('UPDATE "Setting" SET "value"="value" WHERE "key" IN (?, ?)', 'LABEL_LAYOUT', 'STICKER_PRINT_CONFIG');
        const layout = await tx.setting.findUnique({ where: { key: 'LABEL_LAYOUT' } });
        const calibration = await tx.setting.findUnique({ where: { key: 'STICKER_PRINT_CONFIG' } });
        if (layout?.value === layoutValue && calibration?.value === configValue) return { layoutValue, configValue };
        if ((layout?.value ?? null) !== input.expectedLayout || (calibration?.value ?? null) !== input.expectedConfig) throw new Error('Label settings changed in another window. Reload before saving.');
        await tx.setting.upsert({ where: { key: 'LABEL_LAYOUT' }, create: { key: 'LABEL_LAYOUT', value: layoutValue }, update: { value: layoutValue } });
        await tx.setting.upsert({ where: { key: 'STICKER_PRINT_CONFIG' }, create: { key: 'STICKER_PRINT_CONFIG', value: configValue }, update: { value: configValue } });
        await tx.auditLog.create({ data: { action: 'LABEL_TEMPLATE_SAVED', userId: user.id, details: 'Label layout and printer calibration saved together.' } });
        return { layoutValue, configValue };
    });
}
