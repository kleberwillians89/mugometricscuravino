import type { StoryItem } from "../../app/types";
import { memo, useState } from "react";
import MetaStateNotice from "./MetaStateNotice";

type Props = {
  stories: StoryItem[];
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  storiesAvailable: boolean;
  storiesMessage: string;
  updatedAtLabel?: string | null;
  onRetry?: () => void;
};

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function isLikelyBlockedIgCdn(url?: string | null): boolean {
  const value = String(url || "").trim();
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.includes("cdninstagram.com") || hostname.startsWith("scontent-");
  } catch {
    return false;
  }
}

function StoryMedia({ story }: { story: StoryItem }) {
  const primary = story.thumbnail_url || story.media_url || "";
  const blockedByPolicy = isLikelyBlockedIgCdn(primary);
  const [failed, setFailed] = useState(false);

  if (failed || !primary || blockedByPolicy) {
    return <div className="storyThumbFallback">Prévia indisponível</div>;
  }

  if ((story.media_type || "").toUpperCase() === "VIDEO") {
    return (
      <video
        className="storyThumb"
        src={primary}
        muted
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <img
      className="storyThumb"
      src={primary}
      alt={story.media_type || "story"}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function StoriesPanel({
  stories,
  loading = false,
  refreshing = false,
  error = null,
  storiesAvailable,
  storiesMessage,
  updatedAtLabel = null,
  onRetry,
}: Props) {
  const safeStories = arrayOrEmpty<StoryItem>(stories);
  const hasStories = safeStories.length > 0;
  const safeStoriesAvailable = storiesAvailable || hasStories;
  const showUnavailable = !loading && !hasStories && (!safeStoriesAvailable || Boolean(error));
  const pillClass = loading || refreshing || safeStoriesAvailable ? "pillSoft" : "pillDanger";
  const pillLabel = loading
    ? "Carregando..."
    : refreshing
      ? "Atualizando..."
      : safeStoriesAvailable
        ? `${safeStories.length} stories`
        : "Indisponível";

  return (
    <div className="card cardWide">
      <div className="sectionHeader">
        <div>
          <div className="h1">Stories (API)</div>
          <div className="p">Disponibilidade depende da conta/permissões da Instagram Graph API.</div>
        </div>
        <div className="dashboardSectionMeta">
          {updatedAtLabel ? <span className="dashboardTimestamp">{updatedAtLabel}</span> : null}
          <span className={`pill ${pillClass}`}>{pillLabel}</span>
        </div>
      </div>

      {showUnavailable ? (
        <MetaStateNotice
          title="Stories indisponíveis"
          description="A API de stories pode oscilar por permissão, token ou falha transitória."
          tone="unavailable"
          message={storiesMessage || error || "Os stories não puderam ser carregados agora."}
          secondaryMessage="O restante da leitura da Meta continua disponível."
          actionLabel={onRetry ? "Tentar novamente" : undefined}
          onAction={onRetry}
        />
      ) : safeStoriesAvailable ? (
        loading && !safeStories.length ? (
          <div className="storiesGrid">
            <div className="skeleton skeletonStory" />
            <div className="skeleton skeletonStory" />
            <div className="skeleton skeletonStory" />
          </div>
        ) : safeStories.length ? (
          <>
            {error ? <div className="metaInlineNotice">Falha parcial ao atualizar stories. Exibindo a última leitura disponível.</div> : null}
            <div className="storiesGrid">
              {safeStories.map((story, index) => (
              <a
                key={story.id || `story-${index}`}
                className="storyCard"
                href={story.permalink || "#"}
                target="_blank"
                rel="noreferrer"
              >
                <div className="storyMedia">
                  <StoryMedia story={story} />
                </div>
                <div className="smallMuted">{story.media_type || "STORY"}</div>
                <div>{story.timestamp ? new Date(story.timestamp).toLocaleString("pt-BR") : "—"}</div>
              </a>
              ))}
            </div>
          </>
        ) : (
          <MetaStateNotice
            title="Sem stories no período"
            description="A conta continua conectada; só não houve stories retornados para esse recorte."
            tone="empty"
            message={storiesMessage || "Nenhum story retornado no momento."}
          />
        )
      ) : (
        <MetaStateNotice
          title="Stories indisponíveis"
          description="Esse bloco pode falhar isoladamente sem derrubar a página."
          tone="unavailable"
          message={storiesMessage || "Stories indisponíveis nesta conta/permissão."}
          actionLabel={onRetry ? "Tentar novamente" : undefined}
          onAction={onRetry}
        />
      )}
    </div>
  );
}

export default memo(StoriesPanel);
