import { fireEvent, render, screen } from '@testing-library/react';
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from './prompt-input';

const renderInput = (streaming: boolean) => {
  const onSubmit = vi.fn();
  render(
    <PromptInput onSubmit={onSubmit}>
      <PromptInputTextarea />
      <PromptInputSubmit status={streaming ? 'streaming' : 'ready'} onStop={vi.fn()} />
    </PromptInput>
  );
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: 'follow-up question' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  return { onSubmit, textarea };
};

describe('PromptInput Enter key', () => {
  it('keeps the draft and does not submit while a reply streams', async () => {
    const { onSubmit, textarea } = renderInput(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe('follow-up question');
  });

  it('submits when ready', async () => {
    const { onSubmit } = renderInput(false);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ text: 'follow-up question' });
  });
});
