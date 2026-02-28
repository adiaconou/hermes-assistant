/**
 * Maps Tool
 *
 * Provides Google Maps link generation for addresses and locations.
 * Used by the response composer to add clickable map links to responses.
 */

import type { ToolDefinition } from './types.js';

/**
 * Generate a Google Maps search URL for an address.
 */
export function formatMapsUrl(address: string): string {
  const encoded = encodeURIComponent(address).replace(/'/g, '%27');
  return `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}

/**
 * Generate plain-text link text (Label: URL) for messaging apps.
 */
export function formatMapsText(address: string, label?: string): string {
  const displayLabel = label || address;
  return `${displayLabel}: ${formatMapsUrl(address)}`;
}

/**
 * Generate a markdown link to Google Maps.
 */
export function formatMapsMarkdown(address: string, label?: string): string {
  const displayLabel = label || address;
  return `[${displayLabel}](${formatMapsUrl(address)})`;
}

/**
 * Tool definition for formatting Google Maps links.
 *
 * This tool converts addresses or location names into clickable Google Maps links.
 * Google Maps handles address resolution, so it works with:
 * - Exact addresses: "123 Main St, Austin TX"
 * - Place names: "Google HQ"
 * - Ambiguous queries: "Starbucks downtown Austin"
 */
export const formatMapsLink: ToolDefinition = {
  tool: {
    name: 'format_maps_link',
    description:
      'Convert an address or location to a Google Maps link, returning plain text ' +
      '(Label: URL) plus URL/label fields. Call this for any physical address or ' +
      'location mentioned in the step results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        address: {
          type: 'string',
          description: 'Address, place name, or location to link to',
        },
        label: {
          type: 'string',
          description: 'Optional display label for the link (defaults to address)',
        },
      },
      required: ['address'],
    },
  },
  handler: async (input) => {
    const addressInput = input.address;
    if (typeof addressInput !== 'string' || addressInput.trim().length === 0) {
      return { success: false, error: 'address must be a non-empty string.' };
    }

    const address = addressInput.trim();
    const labelInput = typeof input.label === 'string' ? input.label.trim() : '';
    const label = labelInput.length > 0 ? labelInput : address;
    const url = formatMapsUrl(address);
    const text = formatMapsText(address, label);
    const markdown = formatMapsMarkdown(address, label);

    return {
      text,
      markdown,
      url,
      label,
    };
  },
};
