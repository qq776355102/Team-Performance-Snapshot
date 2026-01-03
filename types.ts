
export interface TrackedAddress {
  address: string;
  label: string;
  warZone?: string;
  level?: string; // 新增：地址等级
}

export interface StakingData {
  teamStaking: string;
  role: string;
}

export interface InviteData {
  directReferralQuantity: number;
  teamNumber: string;
}

export interface AddressMetrics extends TrackedAddress {
  directReferrals: number;
  teamNumber: number;
  teamStaking: number;
  effectiveStaking: number;
  referrer: string | null;
  nearestLabeledChildren: string[];
  level: string; // 明确必填项用于展示
}

export interface Snapshot {
  date: string;
  data: AddressMetrics[];
}

export interface DailySummary {
  date: string;
  totalTeamStaking: number;
  totalEffectiveStaking: number;
  totalMembers: number;
}
