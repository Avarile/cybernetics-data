import { getFileIcon, isImage } from '@teable/ui-lib';
import { useMemo } from 'react';
import { useThemeMode } from '../../hooks';

interface IFileCoverProps {
  className?: string;
  mimetype: string;
  url?: string;
  name?: string;
}

export const FileCover = (props: IFileCoverProps) => {
  const { className, mimetype, url, name } = props;
  const themeMode = useThemeMode();
  const FileIcon = useMemo(() => getFileIcon(mimetype, themeMode), [mimetype, themeMode]);

  if (isImage(mimetype)) {
    return <img className={className} src={url} alt={name} />;
  }
  return <FileIcon />;
};
