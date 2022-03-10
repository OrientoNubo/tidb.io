import React, { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { Breadcrumb, Skeleton } from 'antd';
import NextHead from 'next/head';
import Link from 'next/link';
import * as Styled from './blog.styled';
import { CoreLayout } from '~/layouts';
import { OriginLabel, RepostLabel } from './components/labels';
import BlogInfo from '../_components/BlogInfo';
import TiEditor, { createFactory } from '@pingcap-inc/tidb-community-editor';
import '@pingcap-inc/tidb-community-editor/dist/style.css';
import AuthorInfo from './components/AuthorInfo';
import Interactions from './components/Interactions';
import Comments from './components/Comments';
import StatusAlert from './components/StatusAlert';
import { api } from '@tidb-community/datasource';
import { getI18nProps } from '~/utils/i18n.utils';
import { CommunityHead } from '~/components';
import { usePrincipal } from '../blog.hooks';
import ErrorPage from '../../../components/errorPage';

const noop = () => {};

export const getServerSideProps = async (ctx) => {
  const i18nProps = await getI18nProps(['common'])(ctx);
  const { req } = ctx;
  const ip = req.headers['X-Forwarded-For'] || req.headers['x-real-ip'] || req.connection.remoteAddress;

  const { slug } = ctx.params;
  const { shareId } = ctx.query;

  let blog = null,
    isPending = false;
  try {
    blog = await api.blog.getPostBySlug({ slug, ip, shareId });
  } catch (e) {
    if (e.errCode === 'POST_NOT_FOUND') isPending = true;
  }

  return {
    props: {
      ...i18nProps,
      blog,
      isPending,
    },
  };
};

export const BlogPage = ({ blog: blogFromSSR, isPending }) => {
  const { id, isAuthor, hasAuthority } = usePrincipal();

  const router = useRouter();
  const { isReady, query } = router;
  const { slug, shareId } = query;

  const {
    data: blog,
    mutate: reload,
    error: blogError,
  } = useSWR([isReady && 'blog.getPostBySlug', JSON.stringify({ slug, shareId, visit: true })], {
    fallbackData: blogFromSSR,
    revalidateOnMount: true,
    revalidateOnFocus: false,
  });
  const hasPermission = isAuthor(blog) || hasAuthority('REVIEW_POST');
  const error = blogError;
  const loading = !blog || hasPermission === undefined;

  const factory = useMemo(() => createFactory(), []);

  const fragment = useMemo(() => {
    return JSON.parse(blog?.content ?? '[]');
  }, [blog]);

  const onTotalCommentsChange = useCallback(
    (count) => {
      reload(
        (blog) => {
          if (blog) {
            blog.comments = count;
          }
          return blog;
        },
        { revalidate: false }
      );
    },
    [reload]
  );

  if (error) return <ErrorPage />;
  if (loading) return <Skeleton active />;

  if (!hasPermission && isPending) return <ErrorPage statusCode={403} errorMsg="该文章正在审核中" />;

  const BreadcrumbDOM = [<Breadcrumb.Item href="/blog">专栏</Breadcrumb.Item>];
  switch (blog.status) {
    case 'DRAFT': {
      BreadcrumbDOM.push(<Breadcrumb.Item href={`/blog/user/${id}/posts/draft`}>草稿</Breadcrumb.Item>);
      break;
    }
    case 'PENDING': {
      BreadcrumbDOM.push(<Breadcrumb.Item href={`/blog/user/${id}/posts/pending`}>审核中</Breadcrumb.Item>);
      break;
    }
    case 'REJECTED': {
      BreadcrumbDOM.push(<Breadcrumb.Item href={`/blog/user/${id}/posts/rejected`}>未审核通过</Breadcrumb.Item>);
      break;
    }
    default: {
      BreadcrumbDOM.push(
        <Breadcrumb.Item href={`/blog/c/${blog.category?.slug}`}>{blog.category?.name}</Breadcrumb.Item>
      );
    }
  }

  const keyword = [blog.category?.name ?? '', ...(blog.tags ?? []).map((tag) => tag.name)];

  return (
    <CoreLayout MainWrapper={Styled.MainWrapper}>
      <CommunityHead title={`专栏 - ${blog.title}`} description={blog.summary} keyword={keyword} isArticle />

      <NextHead>
        <meta name="twitter:label1" content="By" />
        <meta name="twitter:data1" content={blog.author.username} />
        <meta name="twitter:label2" content="Likes" />
        <meta name="twitter:data2" content={`${blog.likes} ❤`} />
      </NextHead>

      {/*<Styled.VisualContainer>*/}
      <Styled.Content>
        <Styled.Side>
          <Interactions blog={blog} reload={reload} />
        </Styled.Side>
        <Styled.Main>
          <Styled.Breadcrumb>{BreadcrumbDOM}</Styled.Breadcrumb>
          <Styled.StatusAlert>
            <StatusAlert blog={blog} />
          </Styled.StatusAlert>

          <Styled.Body>
            {blog.coverImageURL ? (
              <Styled.CoverImage style={{ backgroundImage: `url(${JSON.stringify(blog.coverImageURL)})` }} />
            ) : undefined}

            <Styled.Title>{blog.title}</Styled.Title>

            <Styled.Meta>
              <AuthorInfo blog={blog} />
            </Styled.Meta>

            <Styled.Meta>
              {blog.origin !== 'ORIGINAL' ? <RepostLabel>转载</RepostLabel> : <OriginLabel>原创</OriginLabel>}

              {blog.tags.map((tag) => (
                <Link href={`/blog/tag/${tag.slug}`} passHref>
                  <BlogInfo.Tag key={tag.slug}>{tag.name}</BlogInfo.Tag>
                </Link>
              ))}
            </Styled.Meta>

            <Styled.Editor>
              <Content fragment={fragment} factory={factory} />
            </Styled.Editor>

            <Styled.BottomActions>
              <Interactions blog={blog} reload={reload} />
            </Styled.BottomActions>
          </Styled.Body>

          {blog.origin !== 'ORIGINAL' ? (
            <Styled.Declaration>声明：本文转载于 {blog.sourceURL}</Styled.Declaration>
          ) : undefined}

          {blog.status === 'PUBLISHED' ? (
            <Comments blog={blog} onTotalCommentsChange={onTotalCommentsChange} />
          ) : undefined}
        </Styled.Main>
      </Styled.Content>
      {/*</Styled.VisualContainer>*/}
    </CoreLayout>
  );
};

const Content = ({ factory, fragment }) => {
  const html = useMemo(() => {
    if (!process.browser) {
      return factory.generateHtml(fragment);
    }
  }, [factory, fragment]);

  if (process.browser) {
    return <TiEditor value={fragment} onChange={noop} factory={factory} disabled />;
  } else {
    return <article dangerouslySetInnerHTML={{ __html: html }} />;
  }
};

export default BlogPage;