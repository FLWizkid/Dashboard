import { IDENTITIES } from '@/lib/types';
import type { FieldSpec } from '@/components/records/RecordDialog';

export const TOOL_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Tool name', type: 'text', required: true, max: 120, placeholder: 'e.g. Google Workspace' },
  { key: 'category', label: 'Category', type: 'text', max: 60, placeholder: 'e.g. Email, Hosting, Design' },
  { key: 'company_id', label: 'Company', type: 'company' },
  { key: 'identity', label: 'Identity', type: 'select', options: IDENTITIES.map((i) => ({ value: i.value, label: i.label })) },
  { key: 'login_account', label: 'Signs in with', type: 'text', max: 200, placeholder: 'e.g. doug@encountive.com' },
  { key: 'url', label: 'Web address', type: 'text', max: 500, placeholder: 'https://' },
  { key: 'cost_amount', label: 'Cost (USD)', type: 'number', hint: 'Price per billing period' },
  {
    key: 'billing_cycle', label: 'Billed', type: 'select', required: true,
    options: [{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Yearly' }, { value: 'none', label: 'Free / one-time' }],
  },
  { key: 'renewal_date', label: 'Next renewal', type: 'date', hint: 'Alerts at 30, 14 and 7 days' },
  {
    key: 'status', label: 'Status', type: 'select', required: true,
    options: [{ value: 'active', label: 'Active' }, { value: 'trial', label: 'Trial' }, { value: 'cancelled', label: 'Cancelled' }],
  },
  { key: 'last_used_on', label: 'Last used', type: 'date', hint: 'Flagged as unused after 60 days' },
  { key: 'auto_renews', label: 'Renews automatically', type: 'checkbox' },
  { key: 'notes', label: 'Notes', type: 'textarea', max: 4000 },
];

export const TOOL_DEFAULTS = { billing_cycle: 'monthly', status: 'active', auto_renews: true, cost_amount: '' };

export const HARDWARE_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Device name', type: 'text', required: true, max: 120, placeholder: 'e.g. Doug\'s ThinkPad' },
  { key: 'kind', label: 'Type', type: 'text', max: 60, placeholder: 'Laptop, phone, security key, router' },
  { key: 'serial', label: 'Serial number', type: 'text', max: 120 },
  { key: 'assigned_to', label: 'Assigned to', type: 'text', max: 120 },
  { key: 'company_id', label: 'Company', type: 'company' },
  {
    key: 'status', label: 'Status', type: 'select', required: true,
    options: [{ value: 'in_use', label: 'In use' }, { value: 'spare', label: 'Spare' }, { value: 'retired', label: 'Retired' }],
  },
  { key: 'purchased_on', label: 'Purchased', type: 'date' },
  { key: 'warranty_until', label: 'Warranty ends', type: 'date' },
  { key: 'notes', label: 'Notes', type: 'textarea', max: 4000 },
];

export function accessFields(tools: { id: string; name: string }[]): FieldSpec[] {
  return [
    { key: 'person', label: 'Person', type: 'text', required: true, max: 120, placeholder: 'e.g. Melissa' },
    { key: 'tool_id', label: 'Tool', type: 'select', required: true, options: tools.map((t) => ({ value: t.id, label: t.name })) },
    { key: 'level', label: 'Access level', type: 'text', max: 60, placeholder: 'Admin, member, viewer' },
    { key: 'granted_on', label: 'Granted', type: 'date' },
    { key: 'last_reviewed_on', label: 'Last reviewed', type: 'date', hint: 'Due for review every 90 days' },
    { key: 'notes', label: 'Notes', type: 'textarea', max: 2000 },
  ];
}
