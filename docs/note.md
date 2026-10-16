# Note

## 개요

### 소개

이 프로젝트는 웹캠으로 입력 받은 비디오 프레임을 실시간 처리하여 원하는 오브젝트들을 찾아 모자이크하는 웹앱입니다. 이 프로젝트를 통해 실시간 스트리밍이나 정적 영상 서빙에 있어서 실시간성을 가지고 동적으로 정책을 업데이트하여 적용할 수 있는 기술적과 실험실 자산을 가질 수 있을 것으로 기대합니다.

### 기본 설정

- 프로젝트 구성 자체는 vite + react로 구성합니다. 이는 최소 구현과 다양한 수단의 PoC를 위함입니다.
- 단일 `Processor` 인터페이스를 먼저 정의합니다. 해당 인터페이스는 `process(frame, objectDescription) frame` 메서드를 가집니다.
- 즉, 특정 프레임을 받아서 내부 상태를 갱신 후 적절히 모자이크한 결과를 반환합니다.
- 리액트 페이지에서 웹캠 비디오 프레임 입력을 실시간으로 받아서 해당 인터페이스를 지속적으로 호출하고 별도 캔버스에 렌더링합니다.
- 또한 별도 드랍다운 메뉴로 프로세서 인터페이스 구현체를 선택할 수 있도록 하고, 변경되면 즉시 교체되어 다음 프레임부터 해당 프로세서를 사용하도록 합니다.

## 구현

### Jev

Jev 1.14 부터는 Box 질의 타입을 추가했습니다. 이 타입은 이미지를 에셋으로, state에 해당 에셋을 참조하게 등록한 후, 질의를 하면 해당 이미지에 대해 판단을 해줍니다.

```
curl https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -H "TypeSafe-Danger-Zone-Images: true" \
  -F 'request={
    "model": "jev-preview",
    "state": {"photo": "6e1d0b7c-kitchen"},
    "assets": {"6e1d0b7c-kitchen": {"type": "image", "part": "kitchen-photo"}},
    "questions": {
      "mug": {"type": "box", "instructions": "the coffee mug in `photo`"}
    }
  };type=application/json' \
  -F 'kitchen-photo=@kitchen.jpg;type=image/jpeg'
```

예제 Request는 이렇게 구성되며,

```
{
  "model": "jev-1.14.0",
  "answers": {
    "mug": {
      "type": "box",
      "box": {
        "top": 0.25,
        "bottom": 0.82,
        "left": 0.44,
        "right": 0.84
      },
      "confidence": 0.92
    }
  },
  "usage": {"input_tokens": 290, "output_tokens": 21}
}
```

예상되는 응답 형태는 이와 같습니다. 아마 이 방안이 현재 존재하는 가장 쉬운 방법일 것으로 보입니다.

다만 이에도 한가지 단점이 있습니다. 현재 Jev 1.14의 이미지 상에서 Box를 추출하는 기능은 단 하나의 바운딩 박스만을 반환합니다.  
예를 들어, 펜을 모두 모자이크 하려고 해도 펜 하나만을 모자이크하게 되는 셈입니다.

#### Jev 기반 버전1, simple decision

이 구현체는 단순히 Jev에 대한 Box 쿼리를 통해 단일 대상에 대한 바운딩 박스를 받고, 해당 영역을 모자이크합니다.  

> 현재 jev를 이용하는 구간은 jev의 네트워크 레이턴시로 인해 편의 상 하나의 프레임이 처리되는 중이라면, 추가로 들어오는 요청에 대해선 프레임을 drop하는 것으로 결정했습니다. 가급적이면 인간이 알아볼 수 없는 속도가 아니면 커버하고 싶었으나, 경우에 따라 13ms 동안만 보여준 이미지에 대해서도 충분히 식별이 가능하다는 연구를 발견하여, 어쩔 수 없이 레이턴시를 기준으로 하였고 모자이크 박스는 다음 프레임 처리까지 유지하는 것으로 결정했습니다.

#### Jev 기반 버전2, scroll decision

이 구현체는 두가지 질문을 Jev에 수행합니다.

> 후술하겠지만, Jev가 1.14부터 이미지를 받을 수 있게 되면서 단순히 Box 질의에만 이미지 지원이 추가되지 않았습니다. 기존의 Noul, Choice, Score 등에도 이미지를 추가할 수 있게 되었습니다.

Jev는 벤치마크 상 GPT 5.6 Terra에 버금가는 지능을 가지고 있습니다. 그렇기에 한가지 도박을 시도해보고자 합니다. 
- Jev에게 Choice를 이용하여 총 몇개의 해당 객체가 존재하는지 고르게 합니다. 일단은 최대 6개로 가정하겠습니다.
- 그리고 Box 연산을 통해 좌상단부터 우하단 순으로 각 N번째 해당 객체를 반환하도록 쿼리를 합니다.
- 위 두가지 쿼리의 조합으로 최대 6개까지 모자이크를 시도합니다.

#### 레퍼런스

- [Jev Box Primitives](https://docs.typesafe.ai/primitives/box)
- [Jev Images Doc](https://docs.typesafe.ai/images)
- [Detecting meaning in RSVP at 13 ms per picture](https://link.springer.com/article/10.3758/s13414-013-0605-z)
- [Introducing System One Models and Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [N8 Programs's jev benchmark vs GPT 5.6 Terra](https://x.com/N8Programs/status/2100088523403432357)
