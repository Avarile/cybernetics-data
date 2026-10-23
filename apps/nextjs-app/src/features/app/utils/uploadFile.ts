import type { IFile } from '@cybernetics/sdk';
import { AttachmentManager } from '@cybernetics/sdk';
import { generateAttachmentId } from '@teable/core';
import { UploadType, type INotifyVo } from '@teable/openapi';

export const uploadFiles = async (
  files: FileList | File[],
  type = UploadType.Table,
  baseId?: string
): Promise<(INotifyVo & { id: string; name: string })[]> => {
  return new Promise((resolve, reject) => {
    const attachmentManager = new AttachmentManager(2);
    const attachments: (INotifyVo & { id: string; name: string })[] = [];
    const fileArray = Array.isArray(files) ? files : Array.from(files);
    attachmentManager.upload(
      fileArray.map((file) => ({ instance: file, id: generateAttachmentId() })),
      type,
      {
        successCallback: (file: IFile, attachment: INotifyVo) => {
          const { instance, id } = file;
          const newAttachment = {
            id,
            name: instance.name,
            ...attachment,
          };
          attachments.push(newAttachment);
          if (attachments.length === files.length) {
            resolve(attachments);
          }
        },
        errorCallback: (_file, error?: string) => {
          reject(error);
        },
      },
      baseId
    );
  });
};
