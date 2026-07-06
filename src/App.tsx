import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { POS } from './pages/POS';
import { Products } from './pages/Products';
import { Customers } from './pages/Customers';
import { Sales } from './pages/Sales';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { ActivityPage } from './pages/Activity';
import { Users } from './pages/Users';
import { Permissions } from './pages/Permissions';
import { Forecasting } from './pages/Forecasting';
import { MainLayout } from './components/Layout/MainLayout';
import { WindowTitleBar } from './components/Layout/WindowTitleBar';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { useAuthStore } from './store/authStore';

type UserPermKey = 'permViewReports' | 'permManageProducts' | 'permViewSales' |
    'permViewGstReports' | 'permEditSettings' | 'permManageUsers' | 'permViewInsights';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
    return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

const InsightsRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const user = useAuthStore((state) => state.user);
    const allowed = !!user && (user.role === 'ADMIN' || user.permViewInsights);
    return allowed ? <>{children}</> : <Navigate to="/pos" replace />;
};

const PermissionRoute: React.FC<{ children: React.ReactNode; perm?: UserPermKey }> = ({ children, perm }) => {
    const user = useAuthStore((state) => state.user);
    const allowed = !!user && (user.role === 'ADMIN' || (perm ? !!user[perm] : false));
    return allowed ? <>{children}</> : <Navigate to="/pos" replace />;
};

// Wraps each page in its own error boundary so one crash doesn't bring down the whole app
const PageBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <ErrorBoundary>{children}</ErrorBoundary>
);

function App() {
    return (
        <div className="h-screen flex flex-col bg-gray-50 dark:bg-dark-bg">
            <WindowTitleBar />
            <div className="flex-1 min-h-0">
                <HashRouter>
                    <Routes>
                        <Route path="/login" element={<Login />} />
                        <Route
                            path="/"
                            element={
                                <ProtectedRoute>
                                    <MainLayout />
                                </ProtectedRoute>
                            }
                        >
                            <Route
                                index
                                element={
                                    <PermissionRoute perm="permViewReports">
                                        <PageBoundary><Dashboard /></PageBoundary>
                                    </PermissionRoute>
                                }
                            />
                            <Route path="pos" element={<PageBoundary><POS /></PageBoundary>} />
                            <Route
                                path="products"
                                element={
                                    <PermissionRoute perm="permManageProducts">
                                        <PageBoundary><Products /></PageBoundary>
                                    </PermissionRoute>
                                }
                            />
                            <Route path="customers" element={<PageBoundary><Customers /></PageBoundary>} />
                            <Route
                                path="sales"
                                element={
                                    <PermissionRoute perm="permViewSales">
                                        <PageBoundary><Sales /></PageBoundary>
                                    </PermissionRoute>
                                }
                            />
                            <Route
                                path="reports"
                                element={
                                    <PermissionRoute perm="permViewGstReports">
                                        <PageBoundary><Reports /></PageBoundary>
                                    </PermissionRoute>
                                }
                            />
                            <Route
                                path="settings"
                                element={
                                    <PermissionRoute perm="permEditSettings">
                                        <PageBoundary><Settings /></PageBoundary>
                                    </PermissionRoute>
                                }
                            />
                            <Route
                                path="users"
                                element={
                                    <PermissionRoute perm="permManageUsers">
                                        <PageBoundary><Users /></PageBoundary>
                                    </PermissionRoute>
                                }
                            />
                            <Route
                                path="permissions"
                                element={
                                    <PermissionRoute perm="permManageUsers">
                                        <PageBoundary><Permissions /></PageBoundary>
                                    </PermissionRoute>
                                }
                            />
                            <Route
                                path="activity"
                                element={
                                    <PermissionRoute perm="permViewReports">
                                        <PageBoundary><ActivityPage /></PageBoundary>
                                    </PermissionRoute>
                                }
                            />
                            <Route
                                path="forecasting"
                                element={
                                    <InsightsRoute>
                                        <PageBoundary><Forecasting /></PageBoundary>
                                    </InsightsRoute>
                                }
                            />
                        </Route>
                    </Routes>
                </HashRouter>
            </div>
        </div>
    );
}

export default App;
