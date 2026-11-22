import { ThemedSelect } from '../../ui/DiscordResourceSelects.jsx';
import React from 'react';

import useOwnerGuilds from '../../hooks/useOwnerGuilds.js';
import ownerApi from '../../services/ownerApi.js';

const FORM_TEMPLATES = [
  'Appeal Form',
  'Staff Application',
  'Partner Application',
  'Report User',
  'Support Request',
  'Custom Blank Form',
];

const QUESTION_TYPES = [
  'Short Text',
  'Long Text',
  'Number',
  'Dropdown',
  'Checkbox',
  'Yes / No',
  'User Mention',
  'Role Mention',
  'Attachment / Link',
];

const ACTION_TYPES = [
  'Create Ticket',
  'Log Submission Only',
  'Notify Staff',
  'DM User',
  'Require Manual Review',
  'Auto-Assign Panel',
];

function getGuildId(guild = {}) {
  return String(guild.guildId || guild.id || '');
}

function getGuildName(guild = {}) {
  return guild.name || guild.guildName || 'Unknown Guild';
}

function formatDate(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleString();
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function getFormId(form = {}) {
  return form.formId || form.id || form.key || form.name || 'unknown';
}

function getFormName(form = {}) {
  return form.name || form.title || form.label || `Form ${getFormId(form)}`;
}

function getPanelName(panel = {}) {
  return panel.name || panel.title || panel.label || 'Unnamed Panel';
}

function getFormAction(form = {}) {
  return form.action || form.submissionAction || form.settings?.action || 'Manual review';
}

function getFormPanelId(form = {}) {
  return form.panelId || form.targetPanelId || form.ticketPanelId || form.settings?.panelId || '';
}

function getFormCategoryId(form = {}) {
  return form.categoryId || form.outputCategoryId || form.ticketCategoryId || form.settings?.categoryId || form.settings?.outputCategoryId || '';
}

function getStaffRoleIds(form = {}) {
  if (Array.isArray(form.staffRoleIds)) return form.staffRoleIds;
  if (Array.isArray(form.settings?.staffRoleIds)) return form.settings.staffRoleIds;
  return [];
}

function getSubmissionTicketId(submission = {}) {
  return submission.ticketId || submission.workflow?.ticketId || null;
}

function getSubmissionTicketChannelId(submission = {}) {
  return submission.ticketChannelId || submission.workflow?.ticketChannelId || null;
}

function isMissingTicketChannel(submission = {}) {
  return Boolean(getSubmissionTicketId(submission) && !getSubmissionTicketChannelId(submission));
}

function statusColor(status, theme) {
  const value = String(status || '').toLowerCase();
  if (['enabled', 'active', 'approved', 'deployed', 'healthy'].includes(value)) return '#86efac';
  if (['pending', 'review', 'draft', 'warning', 'request_info'].includes(value)) return '#fcd34d';
  if (['denied', 'disabled', 'closed', 'missing', 'recovery needed'].includes(value)) return '#fca5a5';
  return theme.mutedText;
}

function StatusPill({ theme, status }) {
  const label = String(status || 'unknown');
  const tone = statusColor(label, theme);

  return (
    <span style={{ border: `1px solid ${tone}`, color: tone, borderRadius: 999, padding: '5px 9px', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {label}
    </span>
  );
}

function StatCard({ title, value, hint, theme, accent = '#c4b5fd' }) {
  return (
    <div style={{ border: '1px solid ' + theme.cardBorder, background: theme.cardBg, borderRadius: 18, padding: 18, boxShadow: theme.shadow }}>
      <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 950, marginTop: 8, color: accent }}>{value}</div>
      {hint ? <div style={{ marginTop: 5, color: theme.mutedText, fontSize: 13 }}>{hint}</div> : null}
    </div>
  );
}

function MiniMetric({ title, value, theme }) {
  return (
    <div style={{ border: '1px solid ' + theme.cardBorder, borderRadius: 14, padding: 12, background: 'rgba(15,23,42,0.22)' }}>
      <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 21, fontWeight: 950 }}>{value}</div>
    </div>
  );
}

function Pill({ label, theme }) {
  return (
    <span style={{ border: '1px solid ' + theme.cardBorder, background: 'rgba(139,92,246,0.12)', color: '#ddd6fe', borderRadius: 999, padding: '7px 10px', fontSize: 12, fontWeight: 850 }}>
      {label}
    </span>
  );
}

function FormsList({ forms, theme }) {
  return (
    <section style={{ border: '1px solid ' + theme.cardBorder, background: theme.cardBg, color: theme.cardText, borderRadius: 20, padding: 18, boxShadow: theme.shadow, display: 'grid', gap: 12 }}>
      <div>
        <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Form Library</div>
        <h3 style={{ margin: '6px 0 0' }}>Forms</h3>
      </div>

      {forms.length ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {forms.slice(0, 8).map((form) => {
            const enabled = form.enabled !== false;
            const questionCount = Array.isArray(form.questions) ? form.questions.length : Number(form.questionCount || 0);
            const staffRoleCount = getStaffRoleIds(form).length;

            return (
              <div key={getFormId(form)} style={{ border: '1px solid ' + theme.cardBorder, borderRadius: 15, padding: 13, background: 'rgba(15,23,42,0.22)', display: 'grid', gap: 9 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div>
                    <strong>{getFormName(form)}</strong>
                    <div style={{ color: theme.mutedText, marginTop: 4, fontSize: 13 }}>{form.description || form.type || 'Universal form'}</div>
                  </div>
                  <StatusPill theme={theme} status={enabled ? 'enabled' : 'disabled'} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,140px),1fr))', gap: 8, color: theme.mutedText, fontSize: 13 }}>
                  <div><strong style={{ color: theme.cardText }}>Questions:</strong> {questionCount}</div>
                  <div><strong style={{ color: theme.cardText }}>Staff Roles:</strong> {staffRoleCount}</div>
                  <div><strong style={{ color: theme.cardText }}>Action:</strong> {getFormAction(form)}</div>
                  <div><strong style={{ color: theme.cardText }}>Updated:</strong> {formatDate(form.updatedAt || form.createdAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div style={{ color: theme.mutedText }}>No forms created yet.</div>}
    </section>
  );
}

function PanelsList({ panels, theme }) {
  return (
    <section style={{ border: '1px solid ' + theme.cardBorder, background: theme.cardBg, color: theme.cardText, borderRadius: 20, padding: 18, boxShadow: theme.shadow, display: 'grid', gap: 12 }}>
      <div>
        <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Deployment</div>
        <h3 style={{ margin: '6px 0 0' }}>Form Panels</h3>
      </div>

      {panels.length ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {panels.slice(0, 8).map((panel) => {
            const deployed = Boolean(panel.channelId && panel.messageId);

            return (
              <div key={panel.panelId || panel.id || getPanelName(panel)} style={{ border: '1px solid ' + theme.cardBorder, borderRadius: 15, padding: 13, background: 'rgba(15,23,42,0.22)', display: 'grid', gap: 9 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div>
                    <strong>{getPanelName(panel)}</strong>
                    <div style={{ color: theme.mutedText, marginTop: 4, fontSize: 13 }}>{panel.formId || 'No form linked'}</div>
                  </div>
                  <StatusPill theme={theme} status={deployed ? 'deployed' : 'draft'} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,140px),1fr))', gap: 8, color: theme.mutedText, fontSize: 13 }}>
                  <div><strong style={{ color: theme.cardText }}>Channel:</strong> {panel.channelId || 'Not deployed'}</div>
                  <div><strong style={{ color: theme.cardText }}>Message:</strong> {panel.messageId || 'Not set'}</div>
                  <div><strong style={{ color: theme.cardText }}>Created:</strong> {formatDate(panel.createdAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div style={{ color: theme.mutedText }}>No form panels deployed yet.</div>}
    </section>
  );
}

function SubmissionsList({ submissions, theme, filter, setFilter }) {
  const filtered = submissions.filter((submission) => {
    if (filter === 'all') return true;
    return String(submission.status || 'pending').toLowerCase() === filter;
  });

  return (
    <section style={{ border: '1px solid ' + theme.cardBorder, background: theme.cardBg, color: theme.cardText, borderRadius: 20, padding: 18, boxShadow: theme.shadow, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Review Queue</div>
          <h3 style={{ margin: '6px 0 0' }}>Recent Submissions</h3>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['pending', 'approved', 'denied', 'request_info', 'closed', 'all'].map((status) => (
            <button key={status} type="button" onClick={() => setFilter(status)} style={{ border: '1px solid ' + (filter === status ? '#c4b5fd' : theme.cardBorder), background: filter === status ? 'rgba(139,92,246,0.22)' : 'rgba(15,23,42,0.30)', color: theme.cardText, borderRadius: 999, padding: '8px 10px', fontWeight: 900, cursor: 'pointer', textTransform: 'capitalize' }}>
              {status.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {filtered.length ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {filtered.slice(0, 10).map((submission) => (
            <div key={submission.submissionId || submission.id || `${submission.formId}-${submission.createdAt}`} style={{ border: '1px solid ' + (isMissingTicketChannel(submission) ? '#fca5a5' : theme.cardBorder), borderRadius: 15, padding: 13, background: 'rgba(15,23,42,0.22)', display: 'grid', gap: 9 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <strong>{submission.formName || submission.formId || 'Unknown Form'}</strong>
                  <div style={{ color: theme.mutedText, marginTop: 4, fontSize: 13 }}>User: {submission.userTag || submission.userId || 'Unknown user'}</div>
                </div>
                <StatusPill theme={theme} status={isMissingTicketChannel(submission) ? 'missing' : (submission.status || 'pending')} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,140px),1fr))', gap: 8, color: theme.mutedText, fontSize: 13 }}>
                <div><strong style={{ color: theme.cardText }}>Created:</strong> {formatDate(submission.createdAt)}</div>
                <div><strong style={{ color: theme.cardText }}>Reviewed:</strong> {formatDate(submission.reviewedAt)}</div>
                <div><strong style={{ color: theme.cardText }}>Ticket:</strong> {getSubmissionTicketId(submission) || 'None'}</div>
                <div><strong style={{ color: theme.cardText }}>Channel:</strong> {getSubmissionTicketChannelId(submission) || 'None'}</div>
              </div>
            </div>
          ))}
        </div>
      ) : <div style={{ color: theme.mutedText }}>No submissions match this filter.</div>}
    </section>
  );
}

function WorkflowHealth({ forms, panels, submissions, overview = {}, theme, card }) {
  const totalSubmissions = overview.submissionCount ?? submissions.length;
  const approved = overview.approvedSubmissionCount ?? submissions.filter((s) => String(s.status || '').toLowerCase() === 'approved').length;
  const denied = overview.deniedSubmissionCount ?? submissions.filter((s) => String(s.status || '').toLowerCase() === 'denied').length;
  const pending = overview.pendingSubmissionCount ?? submissions.filter((s) => String(s.status || 'pending').toLowerCase() === 'pending').length;
  const closed = overview.closedSubmissionCount ?? submissions.filter((s) => String(s.status || '').toLowerCase() === 'closed').length;
  const requestInfo = overview.requestInfoSubmissionCount ?? submissions.filter((s) => String(s.status || '').toLowerCase() === 'request_info').length;
  const ticketConversions = overview.ticketLinkedSubmissionCount ?? submissions.filter((s) => Boolean(getSubmissionTicketId(s))).length;
  const channelLinked = overview.ticketChannelLinkedSubmissionCount ?? submissions.filter((s) => Boolean(getSubmissionTicketChannelId(s))).length;
  const missingChannels = overview.missingTicketChannelCount ?? submissions.filter(isMissingTicketChannel).length;

  const approvalRate = totalSubmissions ? (approved / totalSubmissions) * 100 : 0;
  const denialRate = totalSubmissions ? (denied / totalSubmissions) * 100 : 0;
  const conversionRate = totalSubmissions ? (ticketConversions / totalSubmissions) * 100 : 0;

  const formsMissingRoles = forms.filter((form) => getStaffRoleIds(form).length === 0).length;
  const formsMissingActions = forms.filter((form) => !form.action && !form.submissionAction && !form.settings?.action).length;
  const formsMissingCategory = forms.filter((form) => !getFormCategoryId(form)).length;
  const undeployedPanels = panels.filter((panel) => !panel.channelId || !panel.messageId).length;

  return (
    <>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
        <StatCard title="Approval Rate" value={formatPercent(approvalRate)} hint={`${approved} approved`} theme={theme} accent="#86efac" />
        <StatCard title="Denial Rate" value={formatPercent(denialRate)} hint={`${denied} denied`} theme={theme} accent="#fca5a5" />
        <StatCard title="Ticket Conversion" value={formatPercent(conversionRate)} hint={`${ticketConversions} tickets created`} theme={theme} accent="#93c5fd" />
        <StatCard title="Pending Review" value={pending} hint={`${closed} closed`} theme={theme} accent="#fcd34d" />
        <StatCard title="Request Info" value={requestInfo} hint="Waiting on user" theme={theme} accent="#fcd34d" />
        <StatCard title="Channel Linked" value={channelLinked} hint="Ticket channels linked" theme={theme} accent="#93c5fd" />
        <StatCard title="Missing Channels" value={missingChannels} hint="Recovery risk" theme={theme} accent={missingChannels ? '#fca5a5' : '#86efac'} />
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0 }}>Forms → Ticket Workflow Health</h3>
        <p style={{ marginTop: 0, color: theme.mutedText }}>
          Checks whether forms have actions, staff roles, category targets, deployed panels and recoverable ticket channel links.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
          <MiniMetric title="Missing Staff Roles" value={formsMissingRoles} theme={theme} />
          <MiniMetric title="Missing Actions" value={formsMissingActions} theme={theme} />
          <MiniMetric title="Missing Categories" value={formsMissingCategory} theme={theme} />
          <MiniMetric title="Undeployed Panels" value={undeployedPanels} theme={theme} />
          <MiniMetric title="Missing Ticket Channels" value={missingChannels} theme={theme} />
        </div>
      </section>
    </>
  );
}

function FormTicketMapping({ forms, panels, theme, card }) {
  return (
    <section style={{ ...card, display: 'grid', gap: 12 }}>
      <div>
        <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Workflow Mapping</div>
        <h3 style={{ margin: '6px 0 0' }}>Forms → Ticket Mapping</h3>
      </div>

      {forms.length ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {forms.slice(0, 10).map((form) => {
            const panelId = getFormPanelId(form);
            const categoryId = getFormCategoryId(form);
            const staffRoleCount = getStaffRoleIds(form).length;
            const panel = panels.find((item) => item.panelId === panelId || item.id === panelId || item.formId === getFormId(form));
            const panelDeployed = Boolean(panel?.channelId && panel?.messageId);
            const healthy = staffRoleCount > 0 && Boolean(getFormAction(form)) && Boolean(categoryId || panelDeployed);

            return (
              <div key={getFormId(form)} style={{ border: '1px solid ' + theme.cardBorder, borderRadius: 15, padding: 13, background: 'rgba(15,23,42,0.22)', display: 'grid', gap: 9 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div>
                    <strong>{getFormName(form)}</strong>
                    <div style={{ color: theme.mutedText, marginTop: 4, fontSize: 13 }}>{getFormAction(form)}</div>
                  </div>
                  <StatusPill theme={theme} status={healthy ? 'healthy' : 'warning'} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 8, color: theme.mutedText, fontSize: 13 }}>
                  <div><strong style={{ color: theme.cardText }}>Panel:</strong> {panel ? getPanelName(panel) : 'Not mapped'}</div>
                  <div><strong style={{ color: theme.cardText }}>Panel Status:</strong> {panelDeployed ? 'Deployed' : 'Not deployed'}</div>
                  <div><strong style={{ color: theme.cardText }}>Category:</strong> {categoryId || 'Missing'}</div>
                  <div><strong style={{ color: theme.cardText }}>Staff Roles:</strong> {staffRoleCount}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div style={{ color: theme.mutedText }}>No forms available for workflow mapping yet.</div>}
    </section>
  );
}

export default function FormsHub({ theme }) {
  const { guilds, selectedGuild, setSelectedGuild, loading, error } = useOwnerGuilds();
  const [overview, setOverview] = React.useState(null);
  const [forms, setForms] = React.useState([]);
  const [panels, setPanels] = React.useState([]);
  const [submissions, setSubmissions] = React.useState([]);
  const [formsLoading, setFormsLoading] = React.useState(false);
  const [formsError, setFormsError] = React.useState('');
  const [submissionFilter, setSubmissionFilter] = React.useState('pending');

  const selectedGuildRecord = guilds.find((guild) => getGuildId(guild) === selectedGuild);
  const selectedGuildName = selectedGuildRecord ? getGuildName(selectedGuildRecord) : 'No guild selected';
  const analytics = overview?.analytics || {};

  React.useEffect(() => {
    if (!selectedGuild) {
      setOverview(null);
      setForms([]);
      setPanels([]);
      setSubmissions([]);
      return;
    }

    let cancelled = false;

    async function loadFormsDashboard() {
      try {
        setFormsLoading(true);
        setFormsError('');

        const [overviewPayload, formsPayload, panelsPayload, submissionsPayload] = await Promise.all([
          ownerApi.getFormsWorkflowOverview(selectedGuild),
          ownerApi.getForms(selectedGuild),
          ownerApi.getFormPanels(selectedGuild),
          ownerApi.getFormSubmissions(selectedGuild, 'limit=50'),
        ]);

        if (!cancelled) {
          setOverview(overviewPayload?.overview || null);
          setForms(Array.isArray(formsPayload?.forms) ? formsPayload.forms : []);
          setPanels(Array.isArray(panelsPayload?.panels) ? panelsPayload.panels : []);
          setSubmissions(Array.isArray(submissionsPayload?.submissions) ? submissionsPayload.submissions : []);
        }
      } catch (err) {
        if (!cancelled) {
          setOverview(null);
          setForms([]);
          setPanels([]);
          setSubmissions([]);
          setFormsError(err.message || 'Failed to load forms dashboard.');
        }
      } finally {
        if (!cancelled) setFormsLoading(false);
      }
    }

    loadFormsDashboard();

    return () => {
      cancelled = true;
    };
  }, [selectedGuild]);

  const missingChannelCount = overview?.missingTicketChannelCount ?? submissions.filter(isMissingTicketChannel).length;

  const card = {
    border: '1px solid ' + theme.cardBorder,
    background: theme.cardBg,
    color: theme.cardText,
    borderRadius: 20,
    padding: 18,
    boxShadow: theme.shadow,
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ ...card, background: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(15,23,42,0.08) 48%, rgba(34,197,94,0.10))' }}>
        <p style={{ margin: 0, color: '#c4b5fd', fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Global Forms</p>
        <h1 style={{ margin: '8px 0 0', fontSize: 36, letterSpacing: '-0.04em' }}>Forms Hub</h1>
        <p style={{ marginTop: 8, color: theme.mutedText, lineHeight: 1.6 }}>
          Manage universal forms, deployment panels, review submissions, analytics, and Forms → Ticket workflows from one owner dashboard.
        </p>
      </section>

      {error ? <section style={{ ...card, color: '#fca5a5' }}>{error}</section> : null}
      {formsError ? <section style={{ ...card, color: '#fca5a5' }}>{formsError}</section> : null}

      <section style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <strong>Selected Guild</strong>
          <div style={{ color: theme.mutedText, marginTop: 4 }}>{selectedGuildName}</div>
        </div>

        <ThemedSelect theme={theme}
          value={selectedGuild}
          onChange={(event) => setSelectedGuild(event.target.value)}
          disabled={loading || guilds.length === 0}
          style={{ border: '1px solid ' + theme.cardBorder, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 12, padding: '10px 12px', minWidth: 260, fontWeight: 800 }}
        >
          {guilds.map((guild) => (
            <option key={getGuildId(guild)} value={getGuildId(guild)}>{getGuildName(guild)}</option>
          ))}
        </ThemedSelect>
      </section>

      <section style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <strong>Forms Workflow Health</strong>
          <div style={{ color: theme.mutedText, marginTop: 4 }}>
            {missingChannelCount ? 'Some form-created tickets are missing linked channels.' : 'No missing form ticket channels detected.'}
          </div>
        </div>
        <StatusPill theme={theme} status={missingChannelCount ? 'recovery needed' : 'healthy'} />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
        <StatCard title="Connected Guilds" value={loading ? 'Loading' : String(guilds.length)} hint="Owner accessible" theme={theme} />
        <StatCard title="Active Forms" value={formsLoading ? 'Loading' : String(overview?.enabledFormCount ?? 0)} hint="Enabled templates" theme={theme} accent="#86efac" />
        <StatCard title="Total Forms" value={formsLoading ? 'Loading' : String(overview?.formCount ?? 0)} hint="Saved forms" theme={theme} />
        <StatCard title="Submissions" value={formsLoading ? 'Loading' : String(overview?.submissionCount ?? 0)} hint="Lifetime stored" theme={theme} />
        <StatCard title="Pending Review" value={formsLoading ? 'Loading' : String(overview?.pendingSubmissionCount ?? 0)} hint="Needs staff action" theme={theme} accent="#fcd34d" />
        <StatCard title="Ticket Linked" value={formsLoading ? 'Loading' : String(overview?.ticketLinkedSubmissionCount ?? 0)} hint="Forms bridge" theme={theme} accent="#93c5fd" />
        <StatCard title="Channel Linked" value={formsLoading ? 'Loading' : String(overview?.ticketChannelLinkedSubmissionCount ?? 0)} hint="Ticket channel links" theme={theme} accent="#93c5fd" />
        <StatCard title="Missing Channels" value={formsLoading ? 'Loading' : String(missingChannelCount)} hint="Recovery risk" theme={theme} accent={missingChannelCount ? '#fca5a5' : '#86efac'} />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 14 }}>
        <FormsList forms={forms} theme={theme} />
        <PanelsList panels={panels} theme={theme} />
      </section>

      <WorkflowHealth forms={forms} panels={panels} submissions={submissions} overview={overview || {}} theme={theme} card={card} />

      <FormTicketMapping forms={forms} panels={panels} theme={theme} card={card} />

      <SubmissionsList submissions={submissions} theme={theme} filter={submissionFilter} setFilter={setSubmissionFilter} />

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14 }}>
        <section style={card}>
          <h3 style={{ marginTop: 0 }}>Universal Templates</h3>
          <p style={{ marginTop: 0, color: theme.mutedText }}>Starter templates for the universal forms engine.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{FORM_TEMPLATES.map((template) => <Pill key={template} label={template} theme={theme} />)}</div>
        </section>

        <section style={card}>
          <h3 style={{ marginTop: 0 }}>Question Builder Types</h3>
          <p style={{ marginTop: 0, color: theme.mutedText }}>Supported question types for the first form builder UI pass.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{QUESTION_TYPES.map((type) => <Pill key={type} label={type} theme={theme} />)}</div>
        </section>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14 }}>
        <section style={card}>
          <h3 style={{ marginTop: 0 }}>Submission Actions</h3>
          <p style={{ marginTop: 0, color: theme.mutedText }}>Dashboard-ready action types for form submissions.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{ACTION_TYPES.map((action) => <Pill key={action} label={action} theme={theme} />)}</div>
        </section>

        <section style={card}>
          <h3 style={{ marginTop: 0 }}>Forms Analytics</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            <MiniMetric title="Approved" value={analytics.approved ?? overview?.approvedSubmissionCount ?? 0} theme={theme} />
            <MiniMetric title="Denied" value={analytics.denied ?? overview?.deniedSubmissionCount ?? 0} theme={theme} />
            <MiniMetric title="Request Info" value={overview?.requestInfoSubmissionCount ?? 0} theme={theme} />
            <MiniMetric title="Panels" value={overview?.panelCount ?? 0} theme={theme} />
            <MiniMetric title="Deployed Panels" value={overview?.deployedPanelCount ?? 0} theme={theme} />
          </div>
        </section>
      </section>
    </div>
  );
}
