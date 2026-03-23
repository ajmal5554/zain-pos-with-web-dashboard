import { type LucideIcon, Layers3, LayoutTemplate, RadioTower, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface FeatureMirrorPageProps {
    title: string;
    description: string;
    icon: LucideIcon;
    modules: string[];
}

export function FeatureMirrorPage({ title, description, icon: Icon, modules }: FeatureMirrorPageProps) {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="dashboard-section-title">{title}</h1>
                <p className="dashboard-section-copy">{description}</p>
            </div>

            <Card className="overflow-hidden">
                <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.1fr_0.9fr] lg:p-8">
                    <div className="space-y-5">
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                            <Icon className="h-6 w-6 stroke-[1.9]" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                                POS mirror workspace
                            </h2>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                                This module is now exposed in the web dashboard so route parity exists with the desktop POS app.
                                The next step is wiring the same business flows, forms, filters, and permissions end to end.
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                <LayoutTemplate className="h-4 w-4 stroke-[1.9]" />
                                Surface
                            </div>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Route and page shell added.</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                <RadioTower className="h-4 w-4 stroke-[1.9]" />
                                Data
                            </div>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Needs API parity with desktop flows.</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                <ShieldCheck className="h-4 w-4 stroke-[1.9]" />
                                Access
                            </div>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Role handling still needs full mapping.</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-xl">Desktop feature areas to mirror</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {modules.map((module) => (
                            <div key={module} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                                    <Layers3 className="h-4 w-4 stroke-[1.9]" />
                                </div>
                                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{module}</span>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
