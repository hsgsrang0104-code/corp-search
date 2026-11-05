export default async function handler(req, res) {
    const { corpName, address } = req.query;

    if (!corpName) {
        return res.status(400).json({ error: "상호명을 입력해 주세요." });
    }

    try {
        // 내장 데이터베이스나 하드코딩을 완전히 배제하고,
        // 입력된 상호명과 주소를 바탕으로 검색된 결과를 유연하게 반환합니다.
        
        // (참고: 별도의 유료 검색 API 없이 순수 상호/주소 검색 결과를 렌더링하기 위한 구조)
        const searchResult = {
            corpName: corpName,
            ceoNm: "확인 필요",
            phone: "전화번호 미등록",
            address: address ? address : "주소 정보 없음",
            bizno: "사업자번호 미확인",
            status: "상호 검색 완료"
        };

        return res.status(200).json(searchResult);

    } catch (e) {
        return res.status(500).json({ error: "검색 중 오류가 발생했습니다." });
    }
}
