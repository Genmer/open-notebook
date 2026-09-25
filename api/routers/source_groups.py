from typing import List

from fastapi import APIRouter, Query

from api.models import (
    ClassifyViewResponse,
    CopyToGroupResponse,
    GroupDeleteResponse,
    GroupMembersRequest,
    GroupMembersResponse,
    SourceGroupCreate,
    SourceGroupResponse,
    SourceGroupUpdate,
    SourceViewCreate,
    SourceViewResponse,
    SourceViewUpdate,
    ViewDeleteResponse,
    ViewUngroupResponse,
)
from api.source_group_service import (
    classify_view,
    copy_sources_to_group,
    create_group,
    create_view,
    delete_group,
    delete_view,
    list_groups,
    list_views,
    move_members_to_group,
    ungroup_members,
    update_group,
    update_view,
)

router = APIRouter()


@router.get("/views", response_model=List[SourceViewResponse])
async def list_views_endpoint():
    """List source views; the two built-in views are created on first call."""
    return await list_views()


@router.post("/views", response_model=SourceViewResponse, status_code=201)
async def create_view_endpoint(request: SourceViewCreate):
    return await create_view(request.name, request.view_type)


@router.patch("/views/{view_id}", response_model=SourceViewResponse)
async def update_view_endpoint(view_id: str, request: SourceViewUpdate):
    return await update_view(view_id, request.name)


@router.delete("/views/{view_id}", response_model=ViewDeleteResponse)
async def delete_view_endpoint(view_id: str):
    """Delete a custom view with all its groups (sources stay untouched)."""
    deleted = await delete_view(view_id)
    return ViewDeleteResponse(**deleted)


@router.get("/views/{view_id}/groups", response_model=List[SourceGroupResponse])
async def list_groups_endpoint(view_id: str):
    return await list_groups(view_id)


@router.post(
    "/views/{view_id}/groups", response_model=SourceGroupResponse, status_code=201
)
async def create_group_endpoint(view_id: str, request: SourceGroupCreate):
    return await create_group(view_id, request.name, request.parent_id)


@router.patch("/groups/{group_id}", response_model=SourceGroupResponse)
async def update_group_endpoint(group_id: str, request: SourceGroupUpdate):
    return await update_group(group_id, request)


@router.delete("/groups/{group_id}", response_model=GroupDeleteResponse)
async def delete_group_endpoint(
    group_id: str,
    delete_sources: bool = Query(
        False,
        description="true: delete the sources in the subtree; false: keep sources (ungrouped)",
    ),
):
    return await delete_group(group_id, delete_sources)


@router.post("/groups/{group_id}/members", response_model=GroupMembersResponse)
async def move_members_endpoint(group_id: str, request: GroupMembersRequest):
    """Move sources into the group; a source keeps at most one membership per view."""
    return await move_members_to_group(group_id, request.source_ids)


@router.post("/groups/{group_id}/copy", response_model=CopyToGroupResponse)
async def copy_members_endpoint(group_id: str, request: GroupMembersRequest):
    """Deep-copy sources into the group; per-source failures don't abort the batch."""
    return await copy_sources_to_group(group_id, request.source_ids)


@router.post("/views/{view_id}/ungroup", response_model=ViewUngroupResponse)
async def ungroup_members_endpoint(view_id: str, request: GroupMembersRequest):
    """Remove these sources' memberships within the view (sources stay)."""
    return await ungroup_members(view_id, request.source_ids)


@router.post(
    "/views/{view_id}/classify",
    response_model=ClassifyViewResponse,
    status_code=202,
)
async def classify_view_endpoint(view_id: str):
    """Start AI classification for the view; poll the returned command id or
    GET /api/views/{view_id}/groups for the result."""
    result = await classify_view(view_id)
    return ClassifyViewResponse(**result)
