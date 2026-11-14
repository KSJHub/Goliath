import { DASHBOARD_EMOJIS as E } from '../../shared/PageShell';
import React, { useMemo } from 'react';
import PageShell, {
  EmptyState,
  Notice,
  SectionCard,
} from '../../shared/PageShell';
import { PAGE_LAYOUTS } from "../../ui/layout";
import { createSharedComponentStyles } from "../../ui/components";

export default function Moderation({ selectedGuild, theme }) {
  const styles = useMemo(() => createSharedComponentStyles(theme), [theme]);

  const page = PAGE_LAYOUTS.moderation || {
    title: 'Moderation',
    description: 'Central moderation tools.',
    emptyDescription: 'Select a server to manage moderation.',
  };

  return (
    <PageShell
      title={page.title}
      subtitle={
        selectedGuild
          ? page.description
          : page.emptyDescription
      }
      theme={theme}
    >
      {!selectedGuild && (
        <EmptyState theme={theme} text="Select a server to manage moderation." />
      )}

      {selectedGuild && (
        <div style={styles.futurePage}>
          
          <SectionCard theme={theme}>
            <div style={styles.futureInnerPanel}>
              <h3 style={{ margin: 0 }}>⚔️ Moderation Hub</h3>
              <p style={{ margin: 0, opacity: 0.7 }}>
                This will become your central control for all moderation systems.
              </p>
            </div>
          </SectionCard>

          <div style={styles.futureGrid}>
            
            <div style={styles.futurePanel}>
              <div style={styles.futureInnerPanel}>
                <h4 style={{ margin: 0 }}>{E.CHANNELS} Cases</h4>
                <p style={{ margin: 0 }}>
                  View and manage moderation case history.
                </p>
              </div>
            </div>

            <div style={styles.futurePanel}>
              <div style={styles.futureInnerPanel}>
                <h4 style={{ margin: 0 }}>⚠️ Warnings</h4>
                <p style={{ margin: 0 }}>
                  Track user warnings and enforcement actions.
                </p>
              </div>
            </div>

            <div style={styles.futurePanel}>
              <div style={styles.futureInnerPanel}>
                <h4 style={{ margin: 0 }}>{E.BOT} AutoMod</h4>
                <p style={{ margin: 0 }}>
                  Configure automated moderation filters and punishments.
                </p>
              </div>
            </div>

            <div style={styles.futurePanel}>
              <div style={styles.futureInnerPanel}>
                <h4 style={{ margin: 0 }}>{E.PERMISSIONS} Permissions</h4>
                <p style={{ margin: 0 }}>
                  Control moderator roles and permissions.
                </p>
              </div>
            </div>

          </div>
        </div>
      )}
    </PageShell>
  );
}

