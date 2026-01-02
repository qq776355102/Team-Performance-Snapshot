
export interface TrackedAddress {
  address: string;
  label: string;
  warZone?: string;
}

export interface StakingData {
  teamStaking: string; // BigInt as string
  role: string;
}

export interface InviteData {
  directReferralQuantity: number;
  teamNumber: string;
}

export interface AddressMetrics extends TrackedAddress {
  directReferrals: number;
  teamNumber: number;
  teamStaking: number; // Formatted to decimal
  effectiveStaking: number;
  referrer: string | null;
  nearestLabeledChildren: string[]; // Addresses of children used for effective staking deduction
}

export interface Snapshot {
  date: string; // YYYY-MM-DD
  data: AddressMetrics[];
}

export interface DailySummary {
  date: string;
  totalTeamStaking: number;
  totalEffectiveStaking: number;
  totalMembers: number;
}
