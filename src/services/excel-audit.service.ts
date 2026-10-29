import type {
    ExcelAuditListInput, ExcelAuditListResult, ExcelAuditPreview,
    ExcelAuditStatus, ExcelAuditUploadInput,
} from '../types/excelAudit';

function api() {
    const bridge = window.electronAPI?.excelAudit;
    if (!bridge) throw new Error('Excel audit uploads are available in the desktop POS app.');
    return bridge;
}

async function result<T>(response: Promise<{ success: boolean; data?: T; error?: string }>): Promise<T> {
    const value = await response;
    if (!value.success) throw new Error(value.error || 'The Excel audit request could not be completed.');
    return value.data as T;
}

export const excelAuditService = {
    status: (): Promise<ExcelAuditStatus> => result(api().status()),
    list: (input: ExcelAuditListInput = {}): Promise<ExcelAuditListResult> => result(api().list(input)),
    preview: (input: ExcelAuditUploadInput): Promise<ExcelAuditPreview> => result(api().preview(input)),
    commit: (token: string): Promise<ExcelAuditStatus> => result(api().commit({ token })),
};
