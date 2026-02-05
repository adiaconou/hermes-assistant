/**
 * Vision analysis tools using Gemini.
 */

import type { ToolDefinition } from './types.js';
import type { StoredMediaAttachment } from '../services/conversation/types.js';
import { requirePhoneNumber } from './utils.js';
import { analyzeImage, isAnalyzableImage, GeminiNotConfiguredError } from '../services/google/vision.js';
import { downloadTwilioMedia, getMediaErrorMessage, isImageType } from '../services/twilio/media.js';
import { downloadFile } from '../services/google/drive.js';
import { getConversationStore } from '../services/conversation/index.js';

export const analyzeImageTool: ToolDefinition = {
  tool: {
    name: 'analyze_image',
    description: `Analyze an image using AI vision. Use this to:
- Identify what type of document an image is (receipt, business card, screenshot, etc.)
- Extract text and data from images (OCR)
- Describe what's in a photo
- Answer questions about image content

The image must be provided as either:
1. A Twilio media URL (from an inbound message attachment)
2. A Google Drive file ID (for previously uploaded images)
3. Base64-encoded image data with mime type

Common analysis prompts:
- "What type of document is this?"
- "Extract all text from this image"
- "Extract receipt data as JSON"
- "Extract contact information from this business card"
- "Describe what's in this image"`,
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'What to analyze or extract from the image. Be specific about what information you want.',
        },
        media_url: {
          type: 'string',
          description: 'Twilio media URL from an inbound message (if available)',
        },
        drive_file_id: {
          type: 'string',
          description: 'Google Drive file ID for a previously uploaded image',
        },
        image_base64: {
          type: 'string',
          description: 'Base64-encoded image data (if no media_url or drive_file_id)',
        },
        mime_type: {
          type: 'string',
          description: 'MIME type of the image (required if using image_base64)',
        },
        attachment_index: {
          type: 'number',
          description: 'Index of the media attachment to analyze (0-based, defaults to 0)',
        },
      },
      required: ['prompt'],
    },
  },
  handler: async (input, context) => {
    const phoneNumber = requirePhoneNumber(context);

    const { prompt, media_url, drive_file_id, image_base64, mime_type, attachment_index } = input as {
      prompt: string;
      media_url?: string;
      drive_file_id?: string;
      image_base64?: string;
      mime_type?: string;
      attachment_index?: number;
    };

    try {
      let imageBuffer: Buffer;
      let imageMimeType: string;
      let storedItem: StoredMediaAttachment | undefined;
      let source: 'media_url' | 'drive_file_id' | 'storedMedia' | 'mediaAttachments' | 'base64' | 'none' = 'none';
      const attachmentIndex = attachment_index ?? 0;

      // Priority: explicit media_url > drive_file_id > storedMedia > context attachments > base64
      if (media_url) {
        source = 'media_url';
        // Download from Twilio
        const downloaded = await downloadTwilioMedia(media_url);
        if (!isImageType(downloaded.contentType)) {
          return {
            success: false,
            error: 'The provided media is not an image. Use this tool only for images.',
          };
        }
        imageBuffer = downloaded.buffer;
        imageMimeType = downloaded.contentType;
      } else if (drive_file_id) {
        source = 'drive_file_id';
        // Download from Google Drive
        imageBuffer = await downloadFile(phoneNumber, drive_file_id);
        // Infer MIME type from storedMedia if available, default to JPEG
        storedItem = context.storedMedia?.find(m => m.driveFileId === drive_file_id);
        imageMimeType = storedItem?.mimeType || 'image/jpeg';
        if (!isImageType(imageMimeType)) {
          return {
            success: false,
            error: `Drive file is not an image (${imageMimeType}). Use this tool only for images.`,
          };
        }
      } else if (context.storedMedia && context.storedMedia.length > 0) {
        source = 'storedMedia';
        // Use stored media from context (already uploaded to Drive)
        storedItem = context.storedMedia[attachmentIndex];
        if (!storedItem) {
          return {
            success: false,
            error: `No stored media at index ${attachmentIndex}. Available indices: 0-${context.storedMedia.length - 1}`,
          };
        }
        if (!isImageType(storedItem.mimeType)) {
          return {
            success: false,
            error: `Stored media at index ${attachmentIndex} is not an image (${storedItem.mimeType}). Use this tool only for images.`,
          };
        }
        imageBuffer = await downloadFile(phoneNumber, storedItem.driveFileId);
        imageMimeType = storedItem.mimeType;
      } else if (context.mediaAttachments && context.mediaAttachments.length > 0) {
        source = 'mediaAttachments';
        // Use attachment from context (Twilio URL)
        const attachment = context.mediaAttachments[attachmentIndex];
        if (!attachment) {
          return {
            success: false,
            error: `No attachment at index ${attachmentIndex}. Available indices: 0-${context.mediaAttachments.length - 1}`,
          };
        }
        if (!isImageType(attachment.contentType)) {
          return {
            success: false,
            error: `Attachment at index ${attachmentIndex} is not an image (${attachment.contentType}). Use this tool only for images.`,
          };
        }
        const downloaded = await downloadTwilioMedia(attachment.url);
        imageBuffer = downloaded.buffer;
        imageMimeType = downloaded.contentType;
      } else if (image_base64 && mime_type) {
        source = 'base64';
        // Use provided base64
        if (!isAnalyzableImage(mime_type)) {
          return {
            success: false,
            error: `MIME type ${mime_type} is not a supported image type.`,
          };
        }
        imageBuffer = Buffer.from(image_base64, 'base64');
        imageMimeType = mime_type;
      } else {
        return {
          success: false,
          error: 'No image provided. Provide media_url, drive_file_id, image_base64+mime_type, or ensure mediaAttachments are in context.',
        };
      }

      // If we used Twilio media directly, try to map to stored media for Drive linkage
      if (!storedItem && (source === 'media_url' || source === 'mediaAttachments')) {
        if (context.storedMedia && context.storedMedia.length > 0) {
          storedItem = context.storedMedia[attachmentIndex];
        }
      }

      // Analyze the image
      const analysis = await analyzeImage(imageBuffer, imageMimeType, prompt);

      // Persist analysis metadata for multi-turn conversations
      if (context.messageId) {
        try {
          const driveFileId = storedItem?.driveFileId ?? drive_file_id;
          const driveUrl = storedItem?.webViewLink;
          const conversationStore = getConversationStore();
          await conversationStore.addMessageMetadata(
            context.messageId,
            phoneNumber,
            'image_analysis',
            {
              driveFileId,
              driveUrl,
              mimeType: imageMimeType,
              analysis,
            }
          );
        } catch (metadataError) {
          // Log but don't fail - metadata storage is non-critical
          console.error(JSON.stringify({
            level: 'warn',
            message: 'Failed to persist image analysis metadata',
            error: metadataError instanceof Error ? metadataError.message : String(metadataError),
            timestamp: new Date().toISOString(),
          }));
        }
      }

      return {
        success: true,
        analysis,
        imageSizeBytes: imageBuffer.length,
        mimeType: imageMimeType,
      };
    } catch (error) {
      if (error instanceof GeminiNotConfiguredError) {
        return {
          success: false,
          error: 'Image analysis is not configured. Please contact support.',
        };
      }

      // Check for media download errors
      const mediaError = getMediaErrorMessage(error);
      if (mediaError !== 'Sorry, I had trouble downloading that file. Please try again.') {
        return {
          success: false,
          error: mediaError,
        };
      }

      console.error(JSON.stringify({
        level: 'error',
        message: 'Image analysis failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
