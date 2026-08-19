import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient';
import RestoreConfirmModal from '../../shared/RestoreConfirmModal';
import PremiumLock from '../../shared/PremiumLock.jsx';
import { getTheme } from '../../ui/theme';

import PageShell, {
  SectionCard,
  StatGrid,
  SummaryStat,
  EmptyState,
  LoadingPanel,
  Notice,
  PrimaryButton,
  SecondaryButton,
} from '../../shared/PageShell';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';
