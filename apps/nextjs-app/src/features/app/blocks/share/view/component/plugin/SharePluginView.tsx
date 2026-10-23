import { useView } from '@cybernetics/sdk/hooks';
import type { PluginView as PluginViewInstance } from '@cybernetics/sdk/model/view/plugin.view';
import { PluginPosition, type IShareViewPlugin } from '@teable/openapi';
import { PluginContent } from '@/features/app/components/plugin/PluginContent';

export const PluginView = (props: { shareId: string; plugin?: IShareViewPlugin }) => {
  const { shareId, plugin } = props;
  const view = useView();

  if (!view || !plugin) {
    return;
  }

  const { options, id } = view as PluginViewInstance;
  const { pluginId, pluginInstallId } = options;

  return (
    <PluginContent
      pluginId={pluginId}
      pluginInstallId={pluginInstallId}
      positionId={id}
      pluginUrl={plugin.url}
      shareId={shareId}
      positionType={PluginPosition.View}
    />
  );
};
