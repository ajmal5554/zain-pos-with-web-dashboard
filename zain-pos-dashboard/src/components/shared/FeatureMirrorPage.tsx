import { type LucideIcon, Layers3, LayoutTemplate, RadioTower, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface FeatureMirrorPageProps {
    title: string;
    description: string;
    icon: LucideIcon;
    modules: string[];
}

export function FeatureMirrorPage({ title, description, icon: Icon, modules }: FeatureMirrorPageProps) {
    return (
        <div className="flex-1 space-y-4 pt-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
                    <p className="text-muted-foreground text-sm">
                        {description}
                    </p>
                </div>
            </div>

            <Card className="bg-primary text-primary-foreground overflow-hidden">
                <CardContent className="p-8 lg:p-12 relative">
                    <div className="relative z-10 grid gap-8 lg:grid-cols-[1fr_0.8fr] items-center">
                        <div className="space-y-6">
                            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary-foreground/10 text-primary-foreground">
                                <Icon className="h-8 w-8" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-2xl font-bold tracking-tight">
                                    Feature coming soon
                                </h3>
                                <p className="max-w-xl text-primary-foreground/80 font-medium leading-relaxed text-sm">
                                    This feature is currently available in the desktop application.
                                    We are working on bringing this functionality to the web dashboard soon.
                                </p>
                            </div>
                        </div>

                        <div className="grid gap-3">
                            <div className="flex items-center gap-4 rounded-lg bg-primary-foreground/10 p-4 border border-primary-foreground/10">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-transparent text-primary-foreground">
                                    <LayoutTemplate className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold">Interface Setup</p>
                                    <p className="text-xs text-primary-foreground/70">Page layout is ready</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 rounded-lg bg-primary-foreground/5 p-4 border border-primary-foreground/5 opacity-70">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-transparent text-primary-foreground">
                                    <RadioTower className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold">Data Sync</p>
                                    <p className="text-xs text-primary-foreground/70">Connecting to desktop database</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 rounded-lg bg-primary-foreground/5 p-4 border border-primary-foreground/5 opacity-50">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-transparent text-primary-foreground">
                                    <ShieldCheck className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold">Permissions</p>
                                    <p className="text-xs text-primary-foreground/70">Setting up access roles</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="space-y-4 pt-4">
                <div className="flex items-center gap-3">
                    <div className="h-px flex-grow bg-border" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
                        Planned Features
                    </h3>
                    <div className="h-px flex-grow bg-border" />
                </div>
                
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {modules.map((module) => (
                        <Card key={module} className="shadow-none border-dashed bg-muted/30">
                            <CardContent className="p-4 flex items-center gap-4">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                    <Layers3 className="h-5 w-5" />
                                </div>
                                <span className="text-sm font-medium">{module}</span>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    );
}
