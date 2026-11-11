import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getUserAvatarFileId, setUserAvatarFileId, clearUserAvatar } from "../../lib/blocks/data";
import { avatarDownloadUrl, prepareAvatarImage, uploadAvatarBlob } from "../../lib/blocks/files";
import { translate } from "../../lib/i18n/LocalizationProvider";
import type { TranslationKey } from "../../lib/i18n/dictionary";
import { useCurrentUser } from "./useCurrentUser";

export type Avatar = { fileId: string; url: string };

/**
 * The signed-in user's profile picture, shared by the sidebar, the account
 * menu and the profile page through one cached query. Uploads downscale and
 * push to Blocks Storage, then persist the fileId in UserPreference.
 */
export function useAvatar() {
  const me = useCurrentUser();
  const userId = me.data?.data?.itemId;
  const queryClient = useQueryClient();

  const query = useQuery({
    enabled: Boolean(userId),
    // Silent: a failed avatar read degrades to initials by design (the
    // storage file can 403 from a role/org that lacks file-read, e.g. right
    // after an org switch) — the global QueryCache toast must not fire for
    // that. The read retries on the next mount/stale window anyway.
    meta: { silent: true },
    queryFn: async (): Promise<Avatar | null> => {
      const fileId = await getUserAvatarFileId(userId as string);
      if (!fileId) return null;
      return { fileId, url: await avatarDownloadUrl(fileId) };
    },
    queryKey: ["avatar", userId],
    staleTime: 10 * 60_000
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["avatar"] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const prepared = await prepareAvatarImage(file);
      const fileId = await uploadAvatarBlob(prepared);
      await setUserAvatarFileId(userId as string, fileId);
    },
    onError: (error: Error) => {
      // prepareAvatarImage throws translation keys; anything else is a sync failure.
      const key = error.message as TranslationKey;
      toast.error(translate(key) === key ? translate("toast.avatarFailed") : translate(key));
    },
    onSuccess: () => {
      void invalidate();
      toast.success(translate("toast.avatarUpdated"));
    }
  });

  const remove = useMutation({
    mutationFn: () => clearUserAvatar(userId as string),
    onError: () => toast.error(translate("toast.syncFailed")),
    onSuccess: () => {
      void invalidate();
      toast.success(translate("toast.avatarRemoved"));
    }
  });

  return {
    avatar: query.data ?? undefined,
    isLoading: query.isLoading,
    isBusy: upload.isPending || remove.isPending,
    upload: (file: File) => upload.mutate(file),
    remove: () => remove.mutate()
  };
}
