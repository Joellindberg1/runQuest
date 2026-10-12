// Landningen och touren är lazy-chunkar (routes.tsx, App.tsx). Den första dynamiska importen i en testfil är kall och kan ta längre än
// findBy/waitFor-sekunden när sviten körs parallellt, så filer som renderar dem värmer modulerna i en beforeAll.
export const warmLanding = async (): Promise<void> => {
  await import('@/pages/Index');
};

export const warmOnboarding = async (): Promise<void> => {
  await import('@/features/onboarding/components/OnboardingOrchestrator');
};
