import React from 'react';
import { LandingScreen } from '@/features/landing/components/LandingScreen';

/** `/` för utloggade (ADR 006 beslut 1). Publik: utanför RequireAuth, inga anrop. */
const LandingPage: React.FC = () => <LandingScreen />;

export default LandingPage;
