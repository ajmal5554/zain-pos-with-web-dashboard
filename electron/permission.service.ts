/**
 * Centralized Permission Service
 * Handles all permission validation, role checking, and audit logging
 */

import { logger } from './logger';

export interface UserPermissions {
    id: string;
    role: 'ADMIN' | 'CASHIER';
    isActive: boolean;

    // Permission flags
    permPrintSticker?: boolean;
    permAddItem?: boolean;
    permDeleteProduct?: boolean;
    permVoidSale?: boolean;
    permViewReports?: boolean;
    permEditSettings?: boolean;
    permManageProducts?: boolean;
    permViewSales?: boolean;
    permViewGstReports?: boolean;
    permEditSales?: boolean;
    permManageInventory?: boolean;
    permManageUsers?: boolean;
    permViewCostPrice?: boolean;
    permChangePayment?: boolean;
    permDeleteAudit?: boolean;
    permBulkUpdate?: boolean;
    permBackDateSale?: boolean;
    permViewInsights?: boolean;

    // Limits
    maxDiscount?: number;
}

export interface PermissionCheckResult {
    allowed: boolean;
    reason?: string;
    auditEvent?: {
        userId: string;
        action: string;
        resource?: string;
        success: boolean;
        reason?: string;
    };
}

export class PermissionService {
    /**
     * Check if user has specific permission
     */
    static checkPermission(
        user: UserPermissions | null,
        permission: keyof UserPermissions,
        context?: { action: string; resource?: string }
    ): PermissionCheckResult {
        const action = context?.action || permission;
        const resource = context?.resource;

        // User must be authenticated and active
        if (!user) {
            return {
                allowed: false,
                reason: 'User not authenticated',
                auditEvent: {
                    userId: 'anonymous',
                    action,
                    resource,
                    success: false,
                    reason: 'Not authenticated'
                }
            };
        }

        if (!user.isActive) {
            return {
                allowed: false,
                reason: 'User account is deactivated',
                auditEvent: {
                    userId: user.id,
                    action,
                    resource,
                    success: false,
                    reason: 'Account deactivated'
                }
            };
        }

        // Admin role has all permissions except specific limits
        if (user.role === 'ADMIN') {
            return {
                allowed: true,
                auditEvent: {
                    userId: user.id,
                    action,
                    resource,
                    success: true,
                    reason: 'Admin role'
                }
            };
        }

        // Check specific permission for CASHIER role
        const hasPermission = Boolean(user[permission]);

        return {
            allowed: hasPermission,
            reason: hasPermission ? undefined : `Missing permission: ${permission}`,
            auditEvent: {
                userId: user.id,
                action,
                resource,
                success: hasPermission,
                reason: hasPermission ? 'Permission granted' : `Missing permission: ${permission}`
            }
        };
    }

    /**
     * Check multiple permissions (user needs ALL)
     */
    static checkAllPermissions(
        user: UserPermissions | null,
        permissions: (keyof UserPermissions)[],
        context?: { action: string; resource?: string }
    ): PermissionCheckResult {
        for (const permission of permissions) {
            const result = this.checkPermission(user, permission, context);
            if (!result.allowed) {
                return result;
            }
        }

        return {
            allowed: true,
            auditEvent: {
                userId: user?.id || 'anonymous',
                action: context?.action || 'multi-permission-check',
                resource: context?.resource,
                success: true,
                reason: 'All permissions granted'
            }
        };
    }

    /**
     * Check if user has at least one of the permissions (user needs ANY)
     */
    static checkAnyPermission(
        user: UserPermissions | null,
        permissions: (keyof UserPermissions)[],
        context?: { action: string; resource?: string }
    ): PermissionCheckResult {
        if (!user || !user.isActive) {
            return this.checkPermission(user, permissions[0], context);
        }

        if (user.role === 'ADMIN') {
            return {
                allowed: true,
                auditEvent: {
                    userId: user.id,
                    action: context?.action || 'any-permission-check',
                    resource: context?.resource,
                    success: true,
                    reason: 'Admin role'
                }
            };
        }

        // Check if user has any of the required permissions
        for (const permission of permissions) {
            if (Boolean(user[permission])) {
                return {
                    allowed: true,
                    auditEvent: {
                        userId: user.id,
                        action: context?.action || 'any-permission-check',
                        resource: context?.resource,
                        success: true,
                        reason: `Has permission: ${permission}`
                    }
                };
            }
        }

        return {
            allowed: false,
            reason: `Missing any of required permissions: ${permissions.join(', ')}`,
            auditEvent: {
                userId: user.id,
                action: context?.action || 'any-permission-check',
                resource: context?.resource,
                success: false,
                reason: `Missing required permissions: ${permissions.join(', ')}`
            }
        };
    }

    /**
     * Validate discount amount against user limits
     */
    static validateDiscountLimit(
        user: UserPermissions | null,
        discountAmount: number,
        context?: { action: string; resource?: string }
    ): PermissionCheckResult {
        const basicCheck = this.checkPermission(user, 'permEditSales', {
            action: context?.action || 'validate-discount',
            resource: context?.resource
        });

        if (!basicCheck.allowed) {
            return basicCheck;
        }

        // Admin has no discount limits
        if (user?.role === 'ADMIN') {
            return {
                allowed: true,
                auditEvent: {
                    userId: user.id,
                    action: 'validate-discount',
                    resource: context?.resource,
                    success: true,
                    reason: `Admin discount: ${discountAmount}`
                }
            };
        }

        if (user?.maxDiscount !== undefined && discountAmount > user.maxDiscount) {
            return {
                allowed: false,
                reason: `Discount ${discountAmount} exceeds limit ${user.maxDiscount}`,
                auditEvent: {
                    userId: user?.id || 'anonymous',
                    action: 'validate-discount',
                    resource: context?.resource,
                    success: false,
                    reason: `Discount ${discountAmount} exceeds limit ${user.maxDiscount}`
                }
            };
        }

        return {
            allowed: true,
            auditEvent: {
                userId: user?.id || 'anonymous',
                action: 'validate-discount',
                resource: context?.resource,
                success: true,
                reason: `Discount ${discountAmount} within limit`
            }
        };
    }

    /**
     * Log audit event
     */
    static async logAuditEvent(event: NonNullable<PermissionCheckResult['auditEvent']>): Promise<void> {
        try {
            logger.info('Permission', `${event.userId}: ${event.action}${event.resource ? ` (${event.resource})` : ''} - ${event.success ? 'ALLOWED' : 'DENIED'}${event.reason ? `: ${event.reason}` : ''}`);

            // TODO: Store audit events in database for compliance
            // This could be enhanced to store in a dedicated audit_log table

        } catch (error) {
            logger.error('Permission', 'Failed to log audit event:', error);
        }
    }

    /**
     * Create middleware function for IPC handlers
     */
    static createPermissionMiddleware(
        requiredPermissions: (keyof UserPermissions)[] | 'any' | 'admin-only',
        options: {
            action: string;
            resource?: string;
            checkType?: 'all' | 'any';
            allowSelf?: boolean; // For operations on user's own data
        } = { action: 'unknown' }
    ) {
        return async (
            user: UserPermissions | null,
            additionalContext?: { targetUserId?: string; discountAmount?: number }
        ): Promise<PermissionCheckResult> => {
            let result: PermissionCheckResult;

            // Handle different permission checking strategies
            if (requiredPermissions === 'admin-only') {
                result = {
                    allowed: user?.role === 'ADMIN',
                    reason: user?.role === 'ADMIN' ? undefined : 'Admin role required',
                    auditEvent: {
                        userId: user?.id || 'anonymous',
                        action: options.action,
                        resource: options.resource,
                        success: user?.role === 'ADMIN',
                        reason: user?.role === 'ADMIN' ? 'Admin role granted' : 'Admin role required'
                    }
                };
            } else if (requiredPermissions === 'any') {
                result = {
                    allowed: Boolean(user?.isActive),
                    reason: user?.isActive ? undefined : 'Active user required',
                    auditEvent: {
                        userId: user?.id || 'anonymous',
                        action: options.action,
                        resource: options.resource,
                        success: Boolean(user?.isActive),
                        reason: user?.isActive ? 'Active user' : 'User not active'
                    }
                };
            } else if (options.checkType === 'any') {
                result = this.checkAnyPermission(user, requiredPermissions, {
                    action: options.action,
                    resource: options.resource
                });
            } else {
                result = this.checkAllPermissions(user, requiredPermissions, {
                    action: options.action,
                    resource: options.resource
                });
            }

            // Handle allowSelf option for user data operations
            if (!result.allowed && options.allowSelf && additionalContext?.targetUserId) {
                if (user?.id === additionalContext.targetUserId) {
                    result = {
                        allowed: true,
                        auditEvent: {
                            userId: user.id,
                            action: options.action,
                            resource: options.resource,
                            success: true,
                            reason: 'Self-operation allowed'
                        }
                    };
                }
            }

            // Handle discount validation
            if (result.allowed && additionalContext?.discountAmount !== undefined) {
                result = this.validateDiscountLimit(user, additionalContext.discountAmount, {
                    action: options.action,
                    resource: options.resource
                });
            }

            // Log audit event
            if (result.auditEvent) {
                await this.logAuditEvent(result.auditEvent);
            }

            return result;
        };
    }
}

/**
 * Common permission middleware configurations
 */
export const PermissionMiddleware = {
    // User management
    manageUsers: PermissionService.createPermissionMiddleware(['permManageUsers'], {
        action: 'manage-users',
        resource: 'user-accounts'
    }),

    // Sales operations
    voidSale: PermissionService.createPermissionMiddleware(['permVoidSale'], {
        action: 'void-sale',
        resource: 'sales'
    }),

    editSale: PermissionService.createPermissionMiddleware(['permEditSales'], {
        action: 'edit-sale',
        resource: 'sales'
    }),

    changePayment: PermissionService.createPermissionMiddleware(['permChangePayment'], {
        action: 'change-payment',
        resource: 'sales'
    }),

    // Product management
    manageProducts: PermissionService.createPermissionMiddleware(['permManageProducts'], {
        action: 'manage-products',
        resource: 'inventory'
    }),

    deleteProduct: PermissionService.createPermissionMiddleware(['permDeleteProduct'], {
        action: 'delete-product',
        resource: 'inventory'
    }),

    // Reports and data
    viewReports: PermissionService.createPermissionMiddleware(['permViewReports'], {
        action: 'view-reports',
        resource: 'reports'
    }),

    exportData: PermissionService.createPermissionMiddleware(['permViewReports'], {
        action: 'export-data',
        resource: 'data-export'
    }),

    importData: PermissionService.createPermissionMiddleware('admin-only', {
        action: 'import-data',
        resource: 'data-import'
    }),

    // Settings
    editSettings: PermissionService.createPermissionMiddleware(['permEditSettings'], {
        action: 'edit-settings',
        resource: 'system-settings'
    }),

    // Admin only operations
    adminOnly: PermissionService.createPermissionMiddleware('admin-only', {
        action: 'admin-operation'
    }),

    // Any authenticated user
    authenticated: PermissionService.createPermissionMiddleware('any', {
        action: 'authenticated-operation'
    })
};