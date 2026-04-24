import { memo } from "react";
import type { CommentItem, TopWord } from "../app/types";
import WordCloud from "./WordCloud";
import MetaStateNotice from "./dashboard/MetaStateNotice";

type Props = {
  comments: CommentItem[];
  topWords: TopWord[];
  loading: boolean;
  refreshing?: boolean;
  updatedAtLabel?: string | null;
  hasMore?: boolean;
  error?: string | null;
  message?: string | null;
  onLoadMore?: () => void;
};

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function CommentsPanel({
  comments,
  topWords,
  loading,
  refreshing = false,
  updatedAtLabel = null,
  hasMore = false,
  error = null,
  message = null,
  onLoadMore,
}: Props) {
  const safeComments = arrayOrEmpty<CommentItem>(comments);
  const safeTopWords = arrayOrEmpty<TopWord>(topWords);
  const showSkeleton = loading && safeComments.length === 0;
  const hasTopWords = safeTopWords.length > 0;
  const showUnavailable = Boolean(error) && !safeComments.length && !hasTopWords && !loading;
  const showEmpty = !loading && !showUnavailable && !safeComments.length && !hasTopWords;
  const pillLabel = loading
    ? "Carregando..."
    : refreshing
      ? "Atualizando..."
      : showUnavailable
        ? "Indisponível"
        : `${safeComments.length} comentários`;

  return (
    <div className="card cardWide">
      <div className="sectionHeader">
        <div>
          <div className="h1">Comentários</div>
          <div className="p">Lista + nuvem de palavras dentro do período selecionado.</div>
        </div>
        <div className="dashboardSectionMeta">
          {updatedAtLabel ? <span className="dashboardTimestamp">{updatedAtLabel}</span> : null}
          <span className={`pill ${showUnavailable ? "pillDanger" : "pillSoft"}`}>
            {pillLabel}
          </span>
        </div>
      </div>

      {showUnavailable ? (
        <MetaStateNotice
          title="Comentários indisponíveis"
          description="Esse bloco é secundário e pode falhar sem comprometer o restante da página."
          tone="unavailable"
          message={message || `Falha ao carregar comentários: ${error}`}
          secondaryMessage="O resumo principal continua disponível enquanto esse bloco se recupera."
        />
      ) : showEmpty ? (
        <MetaStateNotice
          title="Sem comentários no período"
          description="A nuvem de palavras e a lista aparecem quando houver comentários sincronizados."
          tone="empty"
          message={message || "Nenhum comentário foi encontrado para esse recorte."}
        />
      ) : (
        <>
          {error ? <div className="metaInlineNotice">Falha parcial ao atualizar comentários. Exibindo a última leitura disponível.</div> : null}

          <div className="commentsGrid">
            <div>
              <div className="smallMuted" style={{ marginBottom: 8 }}>Nuvem de palavras</div>
              {hasTopWords ? (
                <WordCloud words={safeTopWords} />
              ) : loading ? (
                <div className="smallMuted">Carregando palavras mais citadas...</div>
              ) : (
                <div className="smallMuted">Sem palavras suficientes no período.</div>
              )}
            </div>

            <div className="commentsList">
              {showSkeleton ? (
                <>
                  <div className="skeleton skeletonComment" />
                  <div className="skeleton skeletonComment" />
                  <div className="skeleton skeletonComment" />
                </>
              ) : safeComments.length ? (
                safeComments.slice(0, 120).map((c, index) => (
                  <div className="commentItem" key={c.comment_id || `${c.media_id || "media"}-${index}`}>
                    <div className="commentHead">
                      <b>@{c.username || "usuario"}</b>
                      <span>{c.timestamp ? new Date(c.timestamp).toLocaleDateString("pt-BR") : ""}</span>
                    </div>
                    <div>{c.text || "(sem texto)"}</div>
                  </div>
                ))
              ) : (
                <div className="smallMuted">Sem comentários no período.</div>
              )}
              {hasMore && onLoadMore ? (
                <div className="row" style={{ marginTop: 8 }}>
                  <button type="button" className="btn btnGhost" onClick={onLoadMore} disabled={loading}>
                    {loading ? "Carregando..." : "Ver mais comentários"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default memo(CommentsPanel);
